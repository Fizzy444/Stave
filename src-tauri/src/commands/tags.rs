use crate::artwork::ArtworkProcessor;
use lofty::file::TaggedFileExt;
use lofty::tag::{Accessor, Tag, TagExt};
use reqwest;
use rusqlite::Connection;
use serde::Deserialize;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

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

    let mut updated_count = 0;

    for (id, path, mut title, mut artist) in tracks {
        if title.is_none()
            || title.as_deref() == Some("")
            || artist.is_none()
            || artist.as_deref() == Some("")
        {
            let (g_title, g_artist) = guess_metadata_from_path(&path);
            if title.is_none() || title.as_deref() == Some("") {
                title = g_title;
            }
            if artist.is_none() || artist.as_deref() == Some("") {
                artist = g_artist;
            }
        }

        let mut cover_bytes = None;
        let mut searched_title = title.clone();
        let mut searched_artist = artist.clone();

        if let (Some(ref t), Some(ref a)) = (&title, &artist) {
            let query = format!("{} {}", t, a);
            let url = format!(
                "https://itunes.apple.com/search?term={}&entity=song&limit=1",
                urlencoding::encode(&query)
            );
            if let Ok(res) = reqwest::get(&url).await {
                if let Ok(json) = res.json::<ItunesResponse>().await {
                    if let Some(first) = json.results.first() {
                        if let Some(rt) = &first.track_name {
                            searched_title = Some(rt.clone());
                        }
                        if let Some(ra) = &first.artist_name {
                            searched_artist = Some(ra.clone());
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
        }

        let path_clone = path.clone();
        let db_clone = db_arc.clone();
        let app_dir = app_handle.path().app_data_dir().unwrap();

        let success = tokio::task::spawn_blocking(move || -> Result<bool, String> {
            let path_obj = Path::new(&path_clone);
            if !path_obj.exists() { return Ok(false); }
            let mut tagged_file = match lofty::read_from_path(path_obj) {
                Ok(f) => f,
                Err(_) => return Ok(false)
            };
            
            let tag = match tagged_file.primary_tag_mut() {
                Some(t) => t,
                None => {
                    let tag_type = tagged_file.primary_tag_type();
                    tagged_file.insert_tag(Tag::new(tag_type));
                    tagged_file.primary_tag_mut().unwrap()
                }
            };
            
            if let Some(ref t) = searched_title { tag.set_title(t.clone()); }
            if let Some(ref a) = searched_artist { tag.set_artist(a.clone()); }
            
            if let Some(bytes) = &cover_bytes {
                tag.remove_picture_type(lofty::picture::PictureType::CoverFront);
                if let Ok(mut pic) = lofty::picture::Picture::from_reader(&mut std::io::Cursor::new(bytes.clone())) {
                    pic.set_pic_type(lofty::picture::PictureType::CoverFront);
                    tag.push_picture(pic);
                }
            }
            tag.save_to_path(path_obj, lofty::config::WriteOptions::new()).ok();
            
            let mut new_hash = None;
            let mut new_accent = None;
            
            if cover_bytes.is_some() {
                let processor = ArtworkProcessor::new(&app_dir);
                if let Some((hash, acc)) = processor.process(cover_bytes.as_ref().unwrap()) {
                    new_hash = Some(hash);
                    new_accent = Some(acc);
                }
            }
            
            let conn = db_clone.lock().unwrap();
            if cover_bytes.is_some() {
                conn.execute(
                    "UPDATE tracks SET title = ?, artist = ?, art_hash = ?, accent = ? WHERE id = ?",
                    rusqlite::params![searched_title, searched_artist, new_hash, new_accent, id]
                ).ok();
            } else {
                conn.execute(
                    "UPDATE tracks SET title = ?, artist = ? WHERE id = ?",
                    rusqlite::params![searched_title, searched_artist, id]
                ).ok();
            }
            Ok(true)
        }).await.unwrap_or(Ok(false)).unwrap_or(false);

        if success {
            updated_count += 1;
        }

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    Ok(updated_count)
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
                "https://itunes.apple.com/search?term={}&entity=song&limit=1",
                urlencoding::encode(&query)
            );
            if let Ok(res) = reqwest::get(&url).await {
                if let Ok(json) = res.json::<ItunesResponse>().await {
                    if let Some(first) = json.results.first() {
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
