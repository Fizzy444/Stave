use crate::commands::library::Track;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::State;

#[tauri::command]
pub fn search_tracks(
    query: String,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<Vec<Track>, String> {
    let conn = db.lock().unwrap();

    let sql = r#"
        SELECT t.id, t.path, t.title, t.artist, t.album_artist, t.album, t.track_no, t.disc_no, t.duration_ms, t.art_hash, t.accent, t.mtime, t.play_count, t.last_played, t.favorite
        FROM tracks t
        JOIN tracks_fts fts ON t.id = fts.rowid
        WHERE tracks_fts MATCH ?
        ORDER BY rank
        LIMIT 100
    "#;

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let fts_query = format!("{}*", query.replace('"', "\"\""));

    let track_iter = stmt
        .query_map([fts_query], |row| {
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
        .map_err(|e| e.to_string())?;

    let mut tracks = Vec::new();
    for t in track_iter {
        if let Ok(track) = t {
            tracks.push(track);
        }
    }

    Ok(tracks)
}
