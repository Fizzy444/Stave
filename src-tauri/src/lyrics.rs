use reqwest::header::USER_AGENT;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LrcLibResponse {
    pub synced_lyrics: Option<String>,
    pub plain_lyrics: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct LyricsResult {
    pub synced: Option<String>,
    pub plain: Option<String>,
    pub source: String,
}

#[tauri::command]
pub async fn fetch_lyrics(
    track_id: i64,
    title: String,
    artist: String,
    album: String,
    duration_ms: u64,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<LyricsResult, String> {
    let cached = {
        let conn = db.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT synced, plain, source FROM lyrics_cache WHERE track_id = ?")
            .unwrap();
        let mut res = None;
        if let Ok(mut iter) = stmt.query_map([track_id], |row| {
            Ok(LyricsResult {
                synced: row.get(0)?,
                plain: row.get(1)?,
                source: row.get(2)?,
            })
        }) {
            if let Some(Ok(c)) = iter.next() {
                res = Some(c);
            }
        }
        res
    };

    if let Some(c) = cached {
        return Ok(c);
    }

    let duration_s = duration_ms / 1000;
    let url = format!(
        "https://lrclib.net/api/get?track_name={}&artist_name={}&album_name={}&duration={}",
        urlencoding::encode(&title),
        urlencoding::encode(&artist),
        urlencoding::encode(&album),
        duration_s
    );

    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .header(USER_AGENT, "Aural-Music-Player/1.0.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let mut result = LyricsResult {
        synced: None,
        plain: None,
        source: "LRCLIB".into(),
    };

    if res.status().is_success() {
        if let Ok(data) = res.json::<LrcLibResponse>().await {
            result.synced = data.synced_lyrics;
            result.plain = data.plain_lyrics;
        }
    }

    // Cache it
    {
        let conn = db.lock().unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO lyrics_cache (track_id, synced, plain, source, fetched_at) VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![track_id, result.synced, result.plain, result.source, now as i64]
        );
    }

    Ok(result)
}
