use crate::tools::get_tools_dir;
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Debug)]
pub struct YTSearchResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub duration: u32,
}

#[derive(Deserialize)]
struct YTDlpJson {
    id: Option<String>,
    title: Option<String>,
    uploader: Option<String>,
    duration: Option<f64>,
}

#[derive(Serialize)]
pub struct DownloadItem {
    pub id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub status: String,
    pub progress: f32,
}

#[tauri::command]
pub async fn search_youtube(app: AppHandle, query: String) -> Result<Vec<YTSearchResult>, String> {
    let tools_dir = get_tools_dir(&app);
    let yt_dlp = tools_dir.join("yt-dlp.exe");

    if !yt_dlp.exists() {
        return Err("yt-dlp is not installed. Please go to Settings to download tools.".into());
    }

    let search_arg = format!("ytsearch10:{}", query);
    let mut cmd = Command::new(&yt_dlp);
    cmd.arg("--flat-playlist")
        .arg("--dump-json")
        .arg(&search_arg);

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW on windows

    let output = cmd.output().map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(data) = serde_json::from_str::<YTDlpJson>(line) {
            if let Some(id) = data.id {
                let duration = data.duration.unwrap_or(0.0) as u32;
                results.push(YTSearchResult {
                    id,
                    title: data.title.unwrap_or_else(|| "Unknown".to_string()),
                    artist: data.uploader.unwrap_or_else(|| "Unknown".to_string()),
                    duration,
                });
            }
        }
    }

    Ok(results)
}

use lofty::file::TaggedFileExt;
use lofty::tag::{Accessor, Tag, TagExt};
use reqwest;
use std::path::Path;

// Basic text cleaning
fn clean_youtube_title(title: &str) -> String {
    let mut cleaned = title.to_string();
    let fluff = [
        "(Official Video)",
        "[Official Video]",
        "(Official Music Video)",
        "[Official Music Video]",
        "(Lyric Video)",
        "[Lyric Video]",
        "(Lyrics)",
        "[Lyrics]",
        "(Audio)",
        "[Audio]",
        "(Official Audio)",
        "[Official Audio]",
        "4K",
        "AMV",
        "(Slowed)",
        "[Slowed]",
        "(Visualizer)",
        "[Visualizer]",
    ];
    for f in fluff.iter() {
        cleaned = cleaned.replace(f, "");
    }

    // Remove trailing [ID] if it exists (11 chars)
    if let Some(start) = cleaned.rfind('[') {
        if let Some(end) = cleaned.rfind(']') {
            if end == cleaned.len() - 1 && end - start == 12 {
                cleaned.truncate(start);
            }
        }
    }

    cleaned.trim().to_string()
}

fn split_artist_title(cleaned: &str, fallback_artist: &str) -> (String, String) {
    if let Some(idx) = cleaned.find(" - ") {
        return (
            cleaned[..idx].trim().to_string(),
            cleaned[idx + 3..].trim().to_string(),
        );
    }
    if let Some(idx) = cleaned.find(" | ") {
        return (
            cleaned[..idx].trim().to_string(),
            cleaned[idx + 3..].trim().to_string(),
        );
    }
    (fallback_artist.to_string(), cleaned.to_string())
}

#[derive(serde::Deserialize)]
struct ItunesResponse {
    results: Vec<ItunesResult>,
}

#[derive(serde::Deserialize)]
struct ItunesResult {
    #[serde(rename = "artworkUrl100")]
    artwork_url_100: Option<String>,
    #[serde(rename = "trackName")]
    track_name: Option<String>,
    #[serde(rename = "artistName")]
    artist_name: Option<String>,
    #[serde(rename = "collectionName")]
    album_name: Option<String>,
}

#[tauri::command]
pub async fn queue_download(
    app: AppHandle,
    id: String,
    title: String,
    artist: String,
) -> Result<(), String> {
    let db = app
        .state::<std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>>()
        .inner()
        .clone();
    {
        let conn = db.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        conn.execute(
            "INSERT OR IGNORE INTO downloads (id, url, title, artist, status, added_at) VALUES (?, ?, ?, ?, 'downloading', ?)",
            rusqlite::params![id, format!("https://youtube.com/watch?v={}", id), title, artist, now as i64]
        ).map_err(|e| e.to_string())?;
    }

    // Spawn background worker
    tauri::async_runtime::spawn(async move {
        let tools_dir = get_tools_dir(&app);
        let yt_dlp = tools_dir.join("yt-dlp.exe");
        let ffmpeg = tools_dir.join("ffmpeg.exe");
        let download_dir = app.path().audio_dir().unwrap().join("Stave Downloads");
        std::fs::create_dir_all(&download_dir).ok();

        let output_template = download_dir.join("%(title)s.%(ext)s");

        #[allow(unused_mut)]
        let mut cmd = Command::new(&yt_dlp);
        cmd.arg("-x")
            .arg("--audio-format")
            .arg("mp3")
            .arg("--audio-quality")
            .arg("0")
            .arg("--ffmpeg-location")
            .arg(&ffmpeg)
            .arg("-q")
            .arg("--no-warnings")
            .arg("--print")
            .arg("after_move:filepath")
            .arg("-o")
            .arg(output_template.to_str().unwrap())
            .arg(format!("https://youtube.com/watch?v={}", id));

        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        match cmd.output() {
            Ok(output) => {
                let status = if output.status.success() {
                    "completed"
                } else {
                    "failed"
                };

                if output.status.success() {
                    let filepath_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let filepath = Path::new(&filepath_str);

                    if filepath.exists() {
                        let cleaned_title = clean_youtube_title(&title);
                        let (mut final_artist, mut final_title) =
                            split_artist_title(&cleaned_title, &artist);
                        let mut final_album = None;

                        let mut cover_bytes = None;
                        let query = format!("{} {}", final_title, final_artist);
                        let url = format!(
                            "https://itunes.apple.com/search?term={}&entity=song&limit=1",
                            urlencoding::encode(&query)
                        );

                        if let Ok(res) = reqwest::get(&url).await {
                            if let Ok(json) = res.json::<ItunesResponse>().await {
                                if let Some(first) = json.results.first() {
                                    // Use iTunes metadata if available
                                    if let Some(t) = &first.track_name {
                                        final_title = t.clone();
                                    }
                                    if let Some(a) = &first.artist_name {
                                        final_artist = a.clone();
                                    }
                                    if let Some(al) = &first.album_name {
                                        final_album = Some(al.clone());
                                    }

                                    if let Some(art) = &first.artwork_url_100 {
                                        let high_res = art.replace("100x100bb", "600x600bb");
                                        if let Ok(img_res) = reqwest::get(&high_res).await {
                                            if let Ok(bytes) = img_res.bytes().await {
                                                cover_bytes = Some(bytes.to_vec());
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        let filepath_buf = filepath.to_path_buf();

                        let _ = tokio::task::spawn_blocking(move || {
                            let mut tagged_file = match lofty::read_from_path(&filepath_buf) {
                                Ok(f) => f,
                                Err(_) => return,
                            };

                            let tag = match tagged_file.primary_tag_mut() {
                                Some(t) => t,
                                None => {
                                    let tag_type = tagged_file.primary_tag_type();
                                    tagged_file.insert_tag(Tag::new(tag_type));
                                    tagged_file.primary_tag_mut().unwrap()
                                }
                            };

                            tag.set_title(final_title.clone());
                            tag.set_artist(final_artist.clone());
                            if let Some(al) = final_album {
                                tag.set_album(al);
                            }

                            if let Some(bytes) = cover_bytes {
                                tag.remove_picture_type(lofty::picture::PictureType::CoverFront);
                                if let Ok(mut pic) = lofty::picture::Picture::from_reader(
                                    &mut std::io::Cursor::new(bytes),
                                ) {
                                    pic.set_pic_type(lofty::picture::PictureType::CoverFront);
                                    tag.push_picture(pic);
                                }
                            }

                            let _ =
                                tag.save_to_path(&filepath_buf, lofty::config::WriteOptions::new());

                            // Rename the file to "Artist - Title.mp3"
                            let sanitized_artist = final_artist.replace(
                                |c: char| {
                                    c == '/'
                                        || c == '\\'
                                        || c == ':'
                                        || c == '*'
                                        || c == '?'
                                        || c == '"'
                                        || c == '<'
                                        || c == '>'
                                        || c == '|'
                                },
                                "_",
                            );
                            let sanitized_title = final_title.replace(
                                |c: char| {
                                    c == '/'
                                        || c == '\\'
                                        || c == ':'
                                        || c == '*'
                                        || c == '?'
                                        || c == '"'
                                        || c == '<'
                                        || c == '>'
                                        || c == '|'
                                },
                                "_",
                            );
                            let new_name =
                                format!("{} - {}.mp3", sanitized_artist, sanitized_title);
                            if let Some(parent) = filepath_buf.parent() {
                                let new_path = parent.join(&new_name);
                                if !new_path.exists() {
                                    let _ = std::fs::rename(&filepath_buf, &new_path);
                                }
                            }
                        })
                        .await;
                    }
                }

                let conn = db.lock().unwrap();
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                let _ = conn.execute(
                    "UPDATE downloads SET status = ?, completed_at = ? WHERE id = ?",
                    rusqlite::params![status, now as i64, id],
                );
            }
            Err(_) => {
                let conn = db.lock().unwrap();
                let _ = conn.execute(
                    "UPDATE downloads SET status = 'failed' WHERE id = ?",
                    rusqlite::params![id],
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn get_downloads(app: AppHandle) -> Result<Vec<DownloadItem>, String> {
    let db = app.state::<std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>>();
    let conn = db.inner().lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, title, artist, status, progress FROM downloads ORDER BY added_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(DownloadItem {
                id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                status: row.get(3)?,
                progress: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        if let Ok(item) = row {
            items.push(item);
        }
    }

    Ok(items)
}
