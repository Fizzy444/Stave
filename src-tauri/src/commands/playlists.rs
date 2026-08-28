use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Debug)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PlaylistTrack {
    pub playlist_id: i64,
    pub track_id: i64,
    pub position: i64,
}

#[tauri::command]
pub async fn create_playlist(app: AppHandle, name: String) -> Result<Playlist, String> {
    let db = app.state::<Arc<Mutex<rusqlite::Connection>>>();
    let conn = db.lock().unwrap();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    conn.execute(
        "INSERT INTO playlists (name, created_at) VALUES (?, ?)",
        rusqlite::params![name, now],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    Ok(Playlist {
        id,
        name,
        created_at: now,
    })
}

#[tauri::command]
pub async fn get_playlists(app: AppHandle) -> Result<Vec<Playlist>, String> {
    let db = app.state::<Arc<Mutex<rusqlite::Connection>>>();
    let conn = db.lock().unwrap();

    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM playlists ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut playlists = Vec::new();
    for row in rows {
        if let Ok(p) = row {
            playlists.push(p);
        }
    }

    Ok(playlists)
}

#[tauri::command]
pub async fn add_to_playlist(
    app: AppHandle,
    playlist_id: i64,
    track_id: i64,
) -> Result<(), String> {
    let db = app.state::<Arc<Mutex<rusqlite::Connection>>>();
    let conn = db.lock().unwrap();

    // Get max position
    let max_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) FROM playlist_tracks WHERE playlist_id = ?",
            rusqlite::params![playlist_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    conn.execute(
        "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
        rusqlite::params![playlist_id, track_id, max_pos + 1],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_playlist_tracks(app: AppHandle, playlist_id: i64) -> Result<Vec<i64>, String> {
    let db = app.state::<Arc<Mutex<rusqlite::Connection>>>();
    let conn = db.lock().unwrap();

    let mut stmt = conn
        .prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![playlist_id], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;

    let mut track_ids = Vec::new();
    for row in rows {
        if let Ok(id) = row {
            track_ids.push(id);
        }
    }

    Ok(track_ids)
}

#[tauri::command]
pub async fn remove_from_playlist(
    app: AppHandle,
    playlist_id: i64,
    track_id: i64,
) -> Result<(), String> {
    let db = app.state::<Arc<Mutex<rusqlite::Connection>>>();
    let conn = db.lock().unwrap();

    conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?",
        rusqlite::params![playlist_id, track_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
