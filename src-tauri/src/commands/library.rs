use crate::scanner;
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

#[derive(Serialize)]
pub struct Track {
    pub id: i64,
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub duration_ms: Option<u64>,
    pub art_hash: Option<String>,
    pub accent: Option<String>,
    pub mtime: Option<u64>,
    pub play_count: Option<u64>,
    pub last_played: Option<u64>,
    pub favorite: bool,
}

#[tauri::command]
pub fn mark_played(track_id: i64, db: State<'_, Arc<Mutex<Connection>>>) -> Result<(), String> {
    let conn = db.lock().unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    conn.execute(
        "UPDATE tracks SET play_count = play_count + 1, last_played = ? WHERE id = ?",
        rusqlite::params![now as i64, track_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn scan_library(
    app: AppHandle,
    path: String,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<(), String> {
    let db_clone = db.inner().clone();
    let app_clone = app.clone();

    {
        let conn = db_clone.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO folders (path, added_at) VALUES (?, ?)",
            rusqlite::params![path.clone(), now as i64],
        );
    }

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_clone.lock().unwrap();
        scanner::scan_folder(&PathBuf::from(path), &app_clone, &conn);
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn rescan_library(
    app: AppHandle,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<(), String> {
    let folders: Vec<String> = {
        let conn = db.lock().unwrap();
        let mut stmt = conn.prepare("SELECT path FROM folders").unwrap();
        let iter = stmt.query_map([], |row| row.get(0)).unwrap();
        iter.filter_map(|r| r.ok()).collect()
    };
    
    let db_clone = db.inner().clone();
    let app_clone = app.clone();
    
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_clone.lock().unwrap();
        for path in folders {
            scanner::scan_folder(&PathBuf::from(path), &app_clone, &conn);
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_tracks(db: State<'_, Arc<Mutex<Connection>>>) -> Result<Vec<Track>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare_cached("SELECT id, path, title, artist, album_artist, album, track_no, disc_no, duration_ms, art_hash, accent, mtime, play_count, last_played, favorite FROM tracks").unwrap();
    let iter = stmt
        .query_map([], |row| {
            Ok(Track {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                album_artist: row.get(4)?,
                album: row.get(5)?,
                track_no: row.get(6)?,
                disc_no: row.get(7)?,
                duration_ms: row.get::<_, Option<i64>>(8)?.map(|v| v as u64),
                art_hash: row.get(9)?,
                accent: row.get(10)?,
                mtime: row.get::<_, Option<i64>>(11)?.map(|v| v as u64),
                play_count: row.get::<_, Option<i64>>(12)?.map(|v| v as u64),
                last_played: row.get::<_, Option<i64>>(13)?.map(|v| v as u64),
                favorite: row.get::<_, i64>(14).unwrap_or(0) > 0,
            })
        })
        .unwrap();

    let mut tracks = Vec::new();
    for t in iter {
        if let Ok(track) = t {
            tracks.push(track);
        }
    }
    Ok(tracks)
}

#[tauri::command]
pub fn toggle_favorite(
    track_id: i64,
    favorite: bool,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE tracks SET favorite = ? WHERE id = ?",
        rusqlite::params![if favorite { 1 } else { 0 }, track_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn move_track(
    track_id: i64,
    new_folder: String,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<(), String> {
    let conn = db.lock().unwrap();

    // Get current path
    let current_path_str: String = conn
        .query_row(
            "SELECT path FROM tracks WHERE id = ?",
            rusqlite::params![track_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let current_path = std::path::PathBuf::from(&current_path_str);
    let filename = current_path.file_name().ok_or("Invalid filename")?;

    let mut new_path = std::path::PathBuf::from(new_folder);
    new_path.push(filename);

    if new_path.exists() {
        return Err("A file with that name already exists in the destination folder".into());
    }

    // Move the file
    std::fs::rename(&current_path, &new_path).map_err(|e| format!("Failed to move file: {}", e))?;

    // Update db
    conn.execute(
        "UPDATE tracks SET path = ? WHERE id = ?",
        rusqlite::params![new_path.to_str().unwrap(), track_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_track(track_id: i64, db: State<'_, Arc<Mutex<Connection>>>) -> Result<(), String> {
    let conn = db.lock().unwrap();

    // Get current path
    let current_path_str: String = conn
        .query_row(
            "SELECT path FROM tracks WHERE id = ?",
            rusqlite::params![track_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let current_path = std::path::PathBuf::from(&current_path_str);

    // Try to delete file from disk (ignore error if it's already deleted)
    let _ = std::fs::remove_file(&current_path);

    // Remove from database
    conn.execute(
        "DELETE FROM tracks WHERE id = ?",
        rusqlite::params![track_id],
    )
    .map_err(|e| e.to_string())?;

    // Also remove from playlists
    conn.execute(
        "DELETE FROM playlist_tracks WHERE track_id = ?",
        rusqlite::params![track_id],
    )
    .unwrap_or(0);

    Ok(())
}
