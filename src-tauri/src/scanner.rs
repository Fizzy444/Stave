use crate::{artwork, metadata};
use rayon::prelude::*;
use rusqlite::Connection;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

pub struct TrackRecord {
    pub path: String,
    pub meta: metadata::TrackMetadata,
    pub hash: Option<String>,
    pub accent: Option<String>,
    pub size: u64,
    pub mtime: u64,
}

pub fn scan_folder(folder_path: &Path, app_handle: &AppHandle, db: &Arc<Mutex<Connection>>) {
    let app_dir = match app_handle.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("Failed to get app_data_dir: {}", e);
            return;
        }
    };
    let processor = Arc::new(artwork::ArtworkProcessor::new(&app_dir));

    let extensions = [
        "mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "wma", "aiff",
    ];

    // 1. Gather files quickly, ignoring hidden and system directories
    let files: Vec<PathBuf> = WalkDir::new(folder_path)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                if name.starts_with('.')
                    || name.eq_ignore_ascii_case("node_modules")
                    || name.eq_ignore_ascii_case("$RECYCLE.BIN")
                    || name.eq_ignore_ascii_case("System Volume Information")
                    || name.eq_ignore_ascii_case("Windows")
                {
                    return false;
                }
            }
            true
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            if let Some(ext) = e.path().extension().and_then(|s| s.to_str()) {
                extensions.contains(&ext.to_lowercase().as_str())
            } else {
                false
            }
        })
        .map(|e| e.into_path())
        .collect();

    if files.is_empty() {
        return;
    }

    // 2. Fetch existing tracks to detect files that have not changed
    let existing_tracks: HashMap<String, (i64, i64)> = {
        let conn = db.lock().unwrap();
        let mut map = HashMap::new();
        if let Ok(mut stmt) = conn.prepare("SELECT path, mtime, size FROM tracks") {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                ))
            }) {
                for r in rows.flatten() {
                    map.insert(r.0, (r.1, r.2));
                }
            }
        }
        map
    };

    // 3. Fast filter: only process files that are new or whose mtime/size changed
    let mut files_to_process: Vec<(PathBuf, String, u64, u64)> = Vec::new();
    for p in files {
        let md = match fs::metadata(&p) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size = md.len();
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let path_str = p.to_string_lossy().to_string();

        if let Some(&(ex_mtime, ex_size)) = existing_tracks.get(&path_str) {
            if ex_mtime == mtime as i64 && ex_size == size as i64 {
                // Completely unchanged - skip to save CPU and I/O
                continue;
            }
        }

        files_to_process.push((p, path_str, size, mtime));
    }

    if files_to_process.is_empty() {
        return;
    }

    // 4. Set up a bounded threadpool (max 4 threads) to prevent CPU starvation and disk thrashing
    let num_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(2, 4);
    let pool = match rayon::ThreadPoolBuilder::new()
        .num_threads(num_threads)
        .build()
    {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Failed to build thread pool: {}", e);
            return;
        }
    };

    // 5. Process in batches of 50
    const BATCH_SIZE: usize = 50;
    for chunk in files_to_process.chunks(BATCH_SIZE) {
        let proc = Arc::clone(&processor);
        let batch: Vec<TrackRecord> = pool.install(|| {
            chunk
                .par_iter()
                .map(|(p, path_str, size, mtime)| {
                    let (meta, pic_data) = metadata::read_metadata(p);

                    let mut hash = None;
                    let mut accent = None;

                    if let Some(pic) = pic_data {
                        if let Some((h, a)) = proc.process(&pic) {
                            hash = Some(h);
                            accent = Some(a);
                        }
                    }

                    TrackRecord {
                        path: path_str.clone(),
                        meta,
                        hash,
                        accent,
                        size: *size,
                        mtime: *mtime,
                    }
                })
                .collect()
        });

        // 6. Commit batch to SQLite (holds lock for only ~2-5ms)
        {
            let conn = db.lock().unwrap();
            let tx = match conn.unchecked_transaction() {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("Failed to start transaction: {}", e);
                    continue;
                }
            };

            {
                if let Ok(mut stmt) = tx.prepare_cached(
                    "INSERT INTO tracks (
                        path, title, artist, album_artist, album, year, track_no, disc_no, genre,
                        duration_ms, bitrate, sample_rate, art_hash, accent, size, mtime
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET
                        title=excluded.title, artist=excluded.artist, album_artist=excluded.album_artist,
                        album=excluded.album, year=excluded.year, track_no=excluded.track_no, disc_no=excluded.disc_no,
                        genre=excluded.genre, duration_ms=excluded.duration_ms, bitrate=excluded.bitrate,
                        sample_rate=excluded.sample_rate, art_hash=excluded.art_hash, accent=excluded.accent,
                        size=excluded.size, mtime=excluded.mtime",
                ) {
                    for r in batch {
                        let _ = stmt.execute(rusqlite::params![
                            r.path,
                            r.meta.title,
                            r.meta.artist,
                            r.meta.album_artist,
                            r.meta.album,
                            r.meta.year,
                            r.meta.track_no,
                            r.meta.disc_no,
                            r.meta.genre,
                            r.meta.duration_ms.map(|d| d as i64),
                            r.meta.bitrate,
                            r.meta.sample_rate,
                            r.hash,
                            r.accent,
                            r.size as i64,
                            r.mtime as i64,
                        ]);
                    }
                }
            }

            let _ = tx.commit();
        }

        // Notify frontend so tracks appear progressively!
        let _ = app_handle.emit("library:updated", ());
    }
}
