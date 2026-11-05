use crate::artwork::ArtworkProcessor;
use lofty::file::TaggedFileExt;
use lofty::tag::{Accessor, Tag, TagExt};
use reqwest;
use rusqlite::Connection;
use serde::Deserialize;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager, State};
use futures_util::stream::{self, StreamExt};
use std::time::Duration;

#[derive(Deserialize)]
struct ItunesResponse {
    results: Vec<ItunesResult>,
}

#[derive(Deserialize)]
struct ItunesResult {
    #[serde(rename = "artworkUrl100")]
    artwork_url_100: Option<String>,
    #[serde(rename = "trackName")]
    track_name: Option<String>,
    #[serde(rename = "artistName")]
    artist_name: Option<String>,
}

fn guess_metadata_from_path(path_str: &str) -> (Option<String>, Option<String>) {
    let path = Path::new(path_str);
    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
        if let Some(idx) = stem.find(" - ") {
            let artist = stem[..idx].trim().to_string();
            let title = stem[idx + 3..].trim().to_string();
            return (Some(title), Some(artist));
        } else {
            return (Some(stem.to_string()), None);
        }
    }
    (None, None)
}

#[tauri::command]
pub async fn auto_fix_metadata(
    force_all: bool,
    track_ids: Option<Vec<i64>>,
    db: State<'_, Arc<Mutex<Connection>>>,
    app_handle: AppHandle,
) -> Result<u32, String> {
    let db_arc = db.inner().clone();

    let tracks: Vec<(i64, String, Option<String>, Option<String>)> = {
        let conn = db_arc.lock().unwrap();
        let query = if let Some(ref ids) = track_ids {
            let id_list = ids
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "SELECT id, path, title, artist FROM tracks WHERE id IN ({})",
                id_list
            )
        } else if force_all {
            "SELECT id, path, title, artist FROM tracks".to_string()
        } else {
            "SELECT id, path, title, artist FROM tracks WHERE title IS NULL OR artist IS NULL OR title = '' OR artist = '' OR art_hash IS NULL".to_string()
        };
        let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        iter.filter_map(Result::ok).collect()
    };

    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let client = CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("Stave Music/0.1")
            .pool_max_idle_per_host(12)
            .build()
            .expect("metadata HTTP client")
    }).clone();
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;

    let updated = stream::iter(tracks)
        .map(|(id, path, title, artist)| {
            let db = db_arc.clone();
            let client = client.clone();
            let app_dir = app_dir.clone();
            async move {
                let (mut title, mut artist) = (title, artist);
                if title.as_deref().unwrap_or("").trim().is_empty()
                    || artist.as_deref().unwrap_or("").trim().is_empty()
                {
                    let (guessed_title, guessed_artist) = guess_metadata_from_path(&path);
                    if title.as_deref().unwrap_or("").trim().is_empty() { title = guessed_title; }
                    if artist.as_deref().unwrap_or("").trim().is_empty() { artist = guessed_artist; }
                }

                let mut cover_bytes = None;
                let mut result_title = title.clone();
                let mut result_artist = artist.clone();
                if let (Some(t), Some(a)) = (&title, &artist) {
                    if let Some(found) = lookup_itunes(&client, t, a).await {
                        result_title = found.track_name.clone().or(result_title);
                        result_artist = found.artist_name.clone().or(result_artist);
                        if let Some(url) = found.artwork_url_100 {
                            let high_res = url.replace("100x100bb", "1000x1000bb");
                            for artwork_url in [high_res.as_str(), url.as_str()] {
                                if let Ok(response) = client.get(artwork_url).send().await {
                                    if response.status().is_success() {
                                        if let Ok(bytes) = response.bytes().await {
                                            if !bytes.is_empty() {
                                                cover_bytes = Some(bytes.to_vec());
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                tokio::task::spawn_blocking(move || -> bool {
                    let path_obj = Path::new(&path);
                    if !path_obj.exists() { return false; }
                    let mut tagged_file = match lofty::read_from_path(path_obj) {
                        Ok(file) => file,
                        Err(_) => return false,
                    };
                    let tag = match tagged_file.primary_tag_mut() {
                        Some(tag) => tag,
                        None => {
                            let tag_type = tagged_file.primary_tag_type();
                            tagged_file.insert_tag(Tag::new(tag_type));
                            tagged_file.primary_tag_mut().unwrap()
                        }
                    };
                    if let Some(value) = &result_title { tag.set_title(value.clone()); }
                    if let Some(value) = &result_artist { tag.set_artist(value.clone()); }
                    if let Some(bytes) = &cover_bytes {
                        tag.remove_picture_type(lofty::picture::PictureType::CoverFront);
                        if let Ok(mut picture) = lofty::picture::Picture::from_reader(&mut std::io::Cursor::new(bytes.clone())) {
                            picture.set_pic_type(lofty::picture::PictureType::CoverFront);
                            tag.push_picture(picture);
                        }
                    }
                    if tag.save_to_path(path_obj, lofty::config::WriteOptions::new()).is_err() { return false; }

                    let artwork = cover_bytes.as_ref().and_then(|bytes| ArtworkProcessor::new(&app_dir).process(bytes));
                    let conn = db.lock().unwrap();
                    if let Some((hash, accent)) = artwork {
                        conn.execute(
                            "UPDATE tracks SET title = ?, artist = ?, art_hash = ?, accent = ? WHERE id = ?",
                            rusqlite::params![result_title, result_artist, hash, accent, id],
                        ).is_ok()
                    } else {
                        conn.execute(
                            "UPDATE tracks SET title = ?, artist = ? WHERE id = ?",
                            rusqlite::params![result_title, result_artist, id],
                        ).is_ok()
                    }
                }).await.unwrap_or(false)
            }
        })
        .buffer_unordered(6)
        .filter(|ok| futures_util::future::ready(*ok))
        .count()
        .await;

    Ok(updated as u32)
}

fn normalize_match(value: &str) -> String {
    value.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

async fn lookup_itunes(client: &reqwest::Client, title: &str, artist: &str) -> Option<ItunesResult> {
    let query = format!("{} {}", title, artist);
    let url = format!(
        "https://itunes.apple.com/search?term={}&entity=song&limit=25",
        urlencoding::encode(&query)
    );
    let response = client.get(url).send().await.ok()?.error_for_status().ok()?;
    let results = response.json::<ItunesResponse>().await.ok()?.results;
    let wanted_title = normalize_match(title);
    let wanted_artist = normalize_match(artist);
    results.into_iter().map(|item| {
        let result_title = normalize_match(item.track_name.as_deref().unwrap_or(""));
        let result_artist = normalize_match(item.artist_name.as_deref().unwrap_or(""));
        let title_score = if result_title == wanted_title { 4 } else if result_title.contains(&wanted_title) || wanted_title.contains(&result_title) { 2 } else { 0 };
        let artist_score = if result_artist == wanted_artist { 4 } else if result_artist.contains(&wanted_artist) || wanted_artist.contains(&result_artist) { 2 } else { 0 };
        (item, title_score + artist_score)
    }).filter(|(_, score)| *score >= 2).max_by_key(|(_, score)| *score).map(|(item, _)| item)
}

#[tauri::command]
pub async fn update_track_tags(
    track_id: i64,
    path: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    db: State<'_, Arc<Mutex<Connection>>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // 1. If we have title and artist, search for cover
    let mut cover_bytes = None;
    if let (Some(ref t), Some(ref a)) = (&title, &artist) {
        if !t.is_empty() && !a.is_empty() {
            let query = format!("{} {}", t, a);
            let url = format!(
                "https://itunes.apple.com/search?term={}&entity=song&limit=25",
                urlencoding::encode(&query)
            );
            if let Ok(res) = reqwest::get(&url).await {
                if let Ok(json) = res.json::<ItunesResponse>().await {
                    if let Some(first) = json.results.first() {
                        if let Some(art) = &first.artwork_url_100 {
                            let high_res = art.replace("100x100bb", "1000x1000bb");
                            if let Ok(img_res) = reqwest::get(&high_res).await {
                                if let Ok(bytes) = img_res.bytes().await {
                                    cover_bytes = Some(bytes.to_vec());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Perform blocking IO operations
    let db_arc = db.inner().clone();
    let app_data_dir = app_handle.path().app_data_dir().unwrap();

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let path_obj = Path::new(&path);
        let mut tagged_file = lofty::read_from_path(path_obj).map_err(|e| e.to_string())?;
        
        let tag = match tagged_file.primary_tag_mut() {
            Some(t) => t,
            None => {
                let tag_type = tagged_file.primary_tag_type();
                tagged_file.insert_tag(Tag::new(tag_type));
                tagged_file.primary_tag_mut().unwrap()
            }
        };

        if let Some(ref t) = title { tag.set_title(t.clone()); }
        if let Some(ref a) = artist { tag.set_artist(a.clone()); }
        if let Some(ref a) = album { tag.set_album(a.clone()); }

        if let Some(bytes) = &cover_bytes {
            tag.remove_picture_type(lofty::picture::PictureType::CoverFront);
            if let Ok(mut pic) = lofty::picture::Picture::from_reader(&mut std::io::Cursor::new(bytes.clone())) {
                pic.set_pic_type(lofty::picture::PictureType::CoverFront);
                tag.push_picture(pic);
            }
        }

        tag.save_to_path(path_obj, lofty::config::WriteOptions::new()).map_err(|e| e.to_string())?;

        // Format new file name based on artist and title
        let mut new_filename = String::new();
        if let (Some(a), Some(t)) = (&artist, &title) {
            if !a.is_empty() && !t.is_empty() {
                new_filename = format!("{} - {}", a, t);
            } else if !t.is_empty() {
                new_filename = t.clone();
            } else if !a.is_empty() {
                new_filename = a.clone();
            }
        } else if let Some(t) = &title {
            if !t.is_empty() { new_filename = t.clone(); }
        }
        
        let mut final_path = path_obj.to_path_buf();
        let mut final_path_str = path.clone();
        
        if !new_filename.is_empty() {
            // Sanitize filename for Windows/Linux/Mac
            let sanitized = new_filename.replace(|c: char| {
                "\\/:*?\"<>|".contains(c)
            }, "_");
            
            if let Some(ext) = path_obj.extension() {
                final_path.set_file_name(format!("{}.{}", sanitized, ext.to_string_lossy()));
            } else {
                final_path.set_file_name(sanitized);
            }
            
            // Rename file if different and new path doesn't already exist
            if final_path != path_obj && !final_path.exists() {
                if std::fs::rename(path_obj, &final_path).is_ok() {
                    final_path_str = final_path.to_string_lossy().into_owned();
                }
            }
        }

        let mut new_hash = None;
        let mut new_accent = None;
        
        if cover_bytes.is_some() {
            let processor = ArtworkProcessor::new(&app_data_dir);
            if let Some((hash, acc)) = processor.process(cover_bytes.as_ref().unwrap()) {
                new_hash = Some(hash);
                new_accent = Some(acc);
            }
        }

        let conn = db_arc.lock().unwrap();
        if cover_bytes.is_some() {
            conn.execute(
                "UPDATE tracks SET title = ?, artist = ?, album = ?, art_hash = ?, accent = ?, path = ? WHERE id = ?",
                rusqlite::params![title, artist, album, new_hash, new_accent, final_path_str, track_id]
            ).map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                "UPDATE tracks SET title = ?, artist = ?, album = ?, path = ? WHERE id = ?",
                rusqlite::params![title, artist, album, final_path_str, track_id]
            ).map_err(|e| e.to_string())?;
        }

        Ok(())
    }).await.map_err(|e| e.to_string())??;

    Ok(())
}
