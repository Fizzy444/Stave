use crate::{artwork, metadata};
use rayon::prelude::*;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

pub struct ScanResult {
    pub path: String,
    pub meta: metadata::TrackMetadata,
    pub hash: Option<String>,
    pub accent: Option<String>,
    pub size: u64,
    pub mtime: u64,
}

pub fn scan_folder(folder_path: &Path, app_handle: &AppHandle, db: &Connection) {
    let app_dir = app_handle.path().app_data_dir().unwrap();
    let processor = artwork::ArtworkProcessor::new(&app_dir);

    let extensions = ["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav"];

    let files: Vec<PathBuf> = WalkDir::new(folder_path)
        .into_iter()
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

    let results: Vec<ScanResult> = files
        .par_iter()
        .filter_map(|path| {
            let meta = metadata::read_metadata(path)?;

            let mut hash = None;
            let mut accent = None;

            if let Some(pic_data) = &meta.picture {
                if let Some((h, a)) = processor.process(pic_data) {
                    hash = Some(h);
                    accent = Some(a);
                }
            }

            let md = fs::metadata(path).ok()?;
            let size = md.len();
            let mtime = md
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs();

            Some(ScanResult {
                path: path.to_string_lossy().to_string(),
                meta,
                hash,
                accent,
                size,
                mtime,
            })
        })
        .collect();

    let tx = db.unchecked_transaction().unwrap();
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO tracks (
                path, title, artist, album_artist, album, year, track_no, disc_no, genre,
                duration_ms, bitrate, sample_rate, art_hash, accent, size, mtime
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                title=excluded.title, artist=excluded.artist, album_artist=excluded.album_artist,
                album=excluded.album, year=excluded.year, track_no=excluded.track_no, disc_no=excluded.disc_no,
                genre=excluded.genre, duration_ms=excluded.duration_ms, bitrate=excluded.bitrate,
                sample_rate=excluded.sample_rate, art_hash=excluded.art_hash, accent=excluded.accent,
                size=excluded.size, mtime=excluded.mtime"
        ).unwrap();

        for r in results {
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
                r.mtime as i64
            ]);
        }
    }
    tx.commit().unwrap();
}
