use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const INNERTUBE_BASE_URL: &str = "https://music.youtube.com/youtubei/v1";

// Reusing one pooled client avoids a fresh TLS handshake for every InnerTube
// call (search, explore, playlist, radio, account) which dominated the
// perceived metadata load time.
static INNERTUBE_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn innertube_client() -> &'static reqwest::Client {
    INNERTUBE_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
            .timeout(Duration::from_secs(15))
            .pool_idle_timeout(Duration::from_secs(90))
            .build()
            .expect("failed to build InnerTube HTTP client")
    })
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct YTTrackItem {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub duration_secs: u32,
    pub thumbnail_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct YTSection {
    pub title: String,
    pub items: Vec<YTTrackItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct YTExploreData {
    pub sections: Vec<YTSection>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct YTPlaylistDetails {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
    pub track_count: usize,
    pub tracks: Vec<YTTrackItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct YTLibraryPlaylist {
    pub playlist_id: String,
    pub title: String,
    pub thumbnail_url: Option<String>,
    pub subtitle: Option<String>,
}

// Global stream URL cache: videoId -> (streamUrl, timestamp)
type StreamCache = Arc<Mutex<HashMap<String, (String, Instant)>>>;
static STREAM_CACHE: OnceLock<StreamCache> = OnceLock::new();

// Signed YouTube stream URLs stay valid for roughly six hours. We keep them for
// four hours so a restart can reuse the upstream URL instead of paying for a
// fresh yt-dlp run.
const STREAM_CACHE_TTL_SECS: u64 = 4 * 3600;

fn get_stream_cache() -> &'static StreamCache {
    STREAM_CACHE.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

// Per-video locks so that concurrent requests for the same track (the explicit
// play request, the warm-cache task and the proxy) only run one resolver.
type InFlightMap = Arc<tokio::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>;
static IN_FLIGHT_RESOLVES: OnceLock<InFlightMap> = OnceLock::new();

fn get_in_flight_resolves() -> &'static InFlightMap {
    IN_FLIGHT_RESOLVES.get_or_init(|| Arc::new(tokio::sync::Mutex::new(HashMap::new())))
}

// Short-lived metadata caches. Switching between Home/Explore/Library and
// back re-requests the same browse/search payloads, which made the UI look
// like it was fetching everything from scratch each time.
const METADATA_CACHE_TTL: Duration = Duration::from_secs(120);
const ACCOUNT_PLAYLIST_CACHE_TTL: Duration = Duration::from_secs(60);

type ExploreCache = Mutex<Option<(YTExploreData, Instant)>>;
type SearchCache = Mutex<HashMap<String, (Vec<YTTrackItem>, Instant)>>;
type AccountPlaylistCache = Mutex<Option<(Vec<YTLibraryPlaylist>, Instant)>>;

static EXPLORE_CACHE: OnceLock<ExploreCache> = OnceLock::new();
static SEARCH_CACHE: OnceLock<SearchCache> = OnceLock::new();
static ACCOUNT_PLAYLIST_CACHE: OnceLock<AccountPlaylistCache> = OnceLock::new();

fn get_explore_cache() -> &'static ExploreCache {
    EXPLORE_CACHE.get_or_init(|| Mutex::new(None))
}

fn get_search_cache() -> &'static SearchCache {
    SEARCH_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_account_playlist_cache() -> &'static AccountPlaylistCache {
    ACCOUNT_PLAYLIST_CACHE.get_or_init(|| Mutex::new(None))
}

pub fn clear_metadata_cache() {
    *get_explore_cache().lock().unwrap() = None;
    get_search_cache().lock().unwrap().clear();
    *get_account_playlist_cache().lock().unwrap() = None;
}

pub fn clear_stream_cache() {
    get_stream_cache().lock().unwrap().clear();
}

fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn memory_cache_lookup(video_id: &str) -> Option<String> {
    let cache = get_stream_cache();
    let mut map = cache.lock().unwrap();
    if let Some((cached_url, instant)) = map.get(video_id) {
        if instant.elapsed() < Duration::from_secs(STREAM_CACHE_TTL_SECS) {
            return Some(cached_url.clone());
        }
        map.remove(video_id);
    }
    None
}

fn persisted_cache_lookup(app: &tauri::AppHandle, video_id: &str) -> Option<String> {
    let db = app.try_state::<Arc<Mutex<Connection>>>()?;
    let conn = db.lock().ok()?;
    let (url, resolved_at): (String, i64) = conn
        .query_row(
            "SELECT url, resolved_at FROM yt_stream_cache WHERE video_id = ?1",
            [video_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok()?;

    let age = now_epoch_secs().saturating_sub(resolved_at);
    if age >= 0 && age < STREAM_CACHE_TTL_SECS as i64 {
        Some(url)
    } else {
        let _ = conn.execute("DELETE FROM yt_stream_cache WHERE video_id = ?1", [video_id]);
        None
    }
}

fn persisted_cache_store(app: &tauri::AppHandle, video_id: &str, url: &str) {
    let Some(db) = app.try_state::<Arc<Mutex<Connection>>>() else {
        return;
    };
    let Ok(conn) = db.lock() else {
        return;
    };
    let _ = conn.execute(
        "INSERT INTO yt_stream_cache (video_id, url, resolved_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(video_id) DO UPDATE SET
             url = excluded.url,
             resolved_at = excluded.resolved_at",
        rusqlite::params![video_id, url, now_epoch_secs()],
    );
}

fn persisted_cache_remove(app: &tauri::AppHandle, video_id: &str) {
    let Some(db) = app.try_state::<Arc<Mutex<Connection>>>() else {
        return;
    };
    let Ok(conn) = db.lock() else {
        return;
    };
    let _ = conn.execute("DELETE FROM yt_stream_cache WHERE video_id = ?1", [video_id]);
}

/// Clears the persistent stream URL cache, e.g. after the YouTube account changes.
pub fn clear_persisted_stream_cache(conn: &Connection) {
    let _ = conn.execute("DELETE FROM yt_stream_cache", []);
}

fn get_web_remix_context() -> serde_json::Value {
    serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        }
    })
}

async fn innertube_post(
    endpoint: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/{}", INNERTUBE_BASE_URL, endpoint);
    let resp = innertube_client()
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Referer", "https://music.youtube.com/")
        .header("Origin", "https://music.youtube.com")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("X-YouTube-Client-Name", "67")
        .header("X-YouTube-Client-Version", "1.20240101.01.00")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error calling InnerTube /{}: {}", endpoint, e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "InnerTube /{} returned error status: {}",
            endpoint,
            resp.status()
        ));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| {
        format!(
            "Failed to parse response JSON from InnerTube /{}: {}",
            endpoint, e
        )
    })?;

    Ok(json)
}

pub async fn authenticated_ytmusic_post(
    app: &tauri::AppHandle,
    endpoint: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let cookie = saved_yt_cookie(app)
        .ok_or_else(|| "Sign in to YouTube Music to access this library".to_string())?;
    let url = format!("{}/{}", INNERTUBE_BASE_URL, endpoint);
    let mut request = innertube_client()
        .post(url)
        .header("Content-Type", "application/json")
        .header("Referer", "https://music.youtube.com/")
        .header("Origin", "https://music.youtube.com")
        .header("Cookie", &cookie)
        .header("X-YouTube-Client-Name", "67")
        .header("X-YouTube-Client-Version", "1.20240101.01.00")
        .header("X-Goog-AuthUser", "0");
    if let Some(auth) = sapisid_hash(&cookie, "https://music.youtube.com") {
        request = request.header("Authorization", auth);
    }
    let response = request
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("YouTube Music request failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("YouTube Music returned {}", response.status()));
    }
    response
        .json()
        .await
        .map_err(|e| format!("Invalid YouTube Music response: {}", e))
}

fn parse_duration(s: &str) -> Option<u32> {
    let parts: Vec<&str> = s.trim().split(':').collect();
    if parts.len() == 2 {
        let min: u32 = parts[0].parse().ok()?;
        let sec: u32 = parts[1].parse().ok()?;
        Some(min * 60 + sec)
    } else if parts.len() == 3 {
        let hr: u32 = parts[0].parse().ok()?;
        let min: u32 = parts[1].parse().ok()?;
        let sec: u32 = parts[2].parse().ok()?;
        Some(hr * 3600 + min * 60 + sec)
    } else {
        None
    }
}

fn get_runs_text(runs_val: Option<&serde_json::Value>) -> String {
    if let Some(runs) = runs_val.and_then(|r| r.as_array()) {
        runs.iter()
            .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("")
    } else {
        String::new()
    }
}

fn extract_thumbnail(val: &serde_json::Value) -> Option<String> {
    let candidates = [
        val.pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails"),
        val.pointer("/thumbnail/thumbnails"),
        val.pointer("/thumbnailRenderer/musicThumbnailRenderer/thumbnail/thumbnails"),
        val.pointer("/thumbnailRenderer/croppedSquareThumbnailRenderer/thumbnail/thumbnails"),
        val.pointer("/croppedSquareThumbnailRenderer/thumbnail/thumbnails"),
        val.pointer("/thumbnails"),
        val.pointer("/musicVideoTypeRenderer/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails"),
    ];

    let mut best: Option<(u64, String)> = None;
    for cand in candidates.into_iter().flatten() {
        if let Some(arr) = cand.as_array() {
            for t in arr {
                if let Some(url) = t.get("url").and_then(|u| u.as_str()) {
                    let w = t.get("width").and_then(|x| x.as_u64()).unwrap_or(0);
                    let h = t.get("height").and_then(|x| x.as_u64()).unwrap_or(0);
                    let mut u = url.to_string();
                    if u.starts_with("//") {
                        u = format!("https:{}", u);
                    }
                    let score = w * h;
                    match &best {
                        None => best = Some((score, u)),
                        Some((bs, _)) if score >= *bs => best = Some((score, u)),
                        _ => {}
                    }
                }
            }
        }
    }
    best.map(|(_, u)| u)
}

fn find_video_id(val: &serde_json::Value) -> Option<String> {
    if let Some(id) = val.get("videoId").and_then(|v| v.as_str()) {
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }
    match val {
        serde_json::Value::Object(map) => {
            if let Some(watch) = map.get("watchEndpoint") {
                if let Some(id) = watch.get("videoId").and_then(|v| v.as_str()) {
                    if !id.is_empty() {
                        return Some(id.to_string());
                    }
                }
            }
            for (k, v) in map {
                if k == "videoId" {
                    if let Some(id) = v.as_str() {
                        if !id.is_empty() {
                            return Some(id.to_string());
                        }
                    }
                }
                if let Some(id) = find_video_id(v) {
                    return Some(id);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(id) = find_video_id(v) {
                    return Some(id);
                }
            }
        }
        _ => {}
    }
    None
}

fn parse_music_responsive_list_item(renderer: &serde_json::Value) -> Option<YTTrackItem> {
    let video_id = renderer.pointer("/playlistItemData/videoId")
        .or_else(|| renderer.pointer("/navigationEndpoint/watchEndpoint/videoId"))
        .or_else(|| renderer.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs/0/navigationEndpoint/watchEndpoint/videoId"))
        .or_else(|| renderer.pointer("/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint/videoId"))
        .or_else(|| renderer.pointer("/doubleTapCommand/watchEndpoint/videoId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| find_video_id(renderer))?;

    if video_id.is_empty() {
        return None;
    }

    let title = {
        let t = get_runs_text(
            renderer.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs"),
        );
        if t.is_empty() {
            "Unknown Title".to_string()
        } else {
            t
        }
    };

    let mut artist = String::new();
    let mut duration_secs = 0;

    if let Some(col1_runs) = renderer
        .pointer("/flexColumns/1/musicResponsiveListItemFlexColumnRenderer/text/runs")
        .and_then(|v| v.as_array())
    {
        let mut artist_parts = Vec::new();
        let mut skipping_leading_type = true;

        for run in col1_runs {
            if let Some(text) = run.get("text").and_then(|t| t.as_str()) {
                let trimmed = text.trim();
                let lower = trimmed.to_lowercase();
                if skipping_leading_type {
                    if lower == "song"
                        || lower == "video"
                        || lower == "album"
                        || lower == "single"
                        || lower == "ep"
                        || lower == "playlist"
                    {
                        continue;
                    }
                    if trimmed == "•" || trimmed.is_empty() {
                        continue;
                    }
                    skipping_leading_type = false;
                }

                if text.contains('•') {
                    if !artist_parts.is_empty() {
                        break;
                    }
                    continue;
                }

                artist_parts.push(text);
            }
        }

        let a = artist_parts.join("").trim().to_string();
        if !a.is_empty() {
            artist = a;
        }

        for run in col1_runs.iter().rev() {
            if let Some(text) = run.get("text").and_then(|t| t.as_str()) {
                if let Some(dur) = parse_duration(text) {
                    duration_secs = dur;
                    break;
                }
            }
        }
    }

    if duration_secs == 0 {
        if let Some(fixed_dur) = renderer
            .pointer("/fixedColumns/0/musicResponsiveListItemFixedColumnRenderer/text/runs/0/text")
            .and_then(|t| t.as_str())
        {
            if let Some(dur) = parse_duration(fixed_dur) {
                duration_secs = dur;
            }
        }
    }

    if artist.is_empty() {
        artist = "Unknown Artist".to_string();
    }

    let thumbnail_url = extract_thumbnail(renderer)
        .or_else(|| Some(format!("https://i.ytimg.com/vi/{}/hq720.jpg", video_id)));

    Some(YTTrackItem {
        id: video_id,
        title,
        artist,
        duration_secs,
        thumbnail_url,
    })
}

fn parse_playlist_panel_video_renderer(renderer: &serde_json::Value) -> Option<YTTrackItem> {
    let video_id = renderer
        .get("videoId")
        .and_then(|v| v.as_str())
        .or_else(|| {
            renderer
                .pointer("/navigationEndpoint/watchEndpoint/videoId")
                .and_then(|v| v.as_str())
        })
        .map(|s| s.to_string())
        .or_else(|| find_video_id(renderer))?;

    if video_id.is_empty() {
        return None;
    }

    let title = {
        let t = get_runs_text(renderer.pointer("/title/runs"));
        if t.is_empty() {
            "Unknown Title".to_string()
        } else {
            t
        }
    };

    let artist = {
        let mut a = String::new();
        if let Some(runs) = renderer
            .pointer("/longBylineText/runs")
            .or_else(|| renderer.pointer("/shortBylineText/runs"))
            .and_then(|v| v.as_array())
        {
            let mut parts = Vec::new();
            for run in runs {
                if let Some(text) = run.get("text").and_then(|t| t.as_str()) {
                    if text.contains('•') {
                        break;
                    }
                    parts.push(text);
                }
            }
            a = parts.join("").trim().to_string();
        }
        if a.is_empty() {
            "Unknown Artist".to_string()
        } else {
            a
        }
    };

    let duration_secs = renderer
        .pointer("/lengthText/runs/0/text")
        .and_then(|t| t.as_str())
        .and_then(parse_duration)
        .unwrap_or(0);

    let thumbnail_url = extract_thumbnail(renderer)
        .or_else(|| Some(format!("https://i.ytimg.com/vi/{}/hq720.jpg", video_id)));

    Some(YTTrackItem {
        id: video_id,
        title,
        artist,
        duration_secs,
        thumbnail_url,
    })
}

fn parse_music_two_row_item(renderer: &serde_json::Value) -> Option<YTTrackItem> {
    let video_id = renderer.pointer("/navigationEndpoint/watchEndpoint/videoId")
        .or_else(|| renderer.pointer("/title/runs/0/navigationEndpoint/watchEndpoint/videoId"))
        .or_else(|| renderer.pointer("/thumbnailOverlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint/videoId"))
        .and_then(|v| v.as_str())?
        .to_string();

    if video_id.is_empty() {
        return None;
    }

    let title = {
        let t = get_runs_text(renderer.pointer("/title/runs"));
        if t.is_empty() {
            "Unknown Title".to_string()
        } else {
            t
        }
    };

    let artist = {
        let mut a = String::new();
        if let Some(runs) = renderer
            .pointer("/subtitle/runs")
            .and_then(|v| v.as_array())
        {
            let mut parts = Vec::new();
            for run in runs {
                if let Some(text) = run.get("text").and_then(|t| t.as_str()) {
                    if text.contains('•') {
                        break;
                    }
                    parts.push(text);
                }
            }
            a = parts.join("").trim().to_string();
        }
        if a.is_empty() {
            "Unknown Artist".to_string()
        } else {
            a
        }
    };

    let thumbnail_url = extract_thumbnail(renderer)
        .or_else(|| Some(format!("https://i.ytimg.com/vi/{}/hq720.jpg", video_id)));

    Some(YTTrackItem {
        id: video_id,
        title,
        artist,
        duration_secs: 0,
        thumbnail_url,
    })
}

fn collect_track_items(val: &serde_json::Value, out: &mut Vec<YTTrackItem>) {
    match val {
        serde_json::Value::Object(map) => {
            if let Some(renderer) = map.get("musicResponsiveListItemRenderer") {
                if let Some(item) = parse_music_responsive_list_item(renderer) {
                    out.push(item);
                    return;
                }
            }
            if let Some(renderer) = map.get("playlistPanelVideoRenderer") {
                if let Some(item) = parse_playlist_panel_video_renderer(renderer) {
                    out.push(item);
                    return;
                }
            }
            if let Some(renderer) = map.get("musicTwoRowItemRenderer") {
                if let Some(item) = parse_music_two_row_item(renderer) {
                    out.push(item);
                    return;
                }
            }
            for (_k, v) in map {
                collect_track_items(v, out);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_track_items(v, out);
            }
        }
        _ => {}
    }
}

fn parse_browse_sections(val: &serde_json::Value, sections: &mut Vec<YTSection>) {
    match val {
        serde_json::Value::Object(map) => {
            if let Some(renderer) = map.get("musicCarouselShelfRenderer") {
                let title = renderer
                    .pointer("/header/musicCarouselShelfBasicHeaderRenderer/title/runs/0/text")
                    .or_else(|| renderer.pointer("/header/musicHeaderRenderer/title/runs/0/text"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Trending")
                    .to_string();

                let mut items = Vec::new();
                if let Some(contents) = renderer.get("contents").and_then(|c| c.as_array()) {
                    for item in contents {
                        let mut track_items = Vec::new();
                        collect_track_items(item, &mut track_items);
                        items.extend(track_items);
                    }
                }

                if !items.is_empty() {
                    let mut seen = std::collections::HashSet::new();
                    items.retain(|i| seen.insert(i.id.clone()));
                    sections.push(YTSection { title, items });
                }
                return;
            }

            if let Some(renderer) = map.get("musicShelfRenderer") {
                let title = renderer
                    .pointer("/title/runs/0/text")
                    .or_else(|| {
                        renderer.pointer("/header/musicShelfHeaderRenderer/title/runs/0/text")
                    })
                    .and_then(|v| v.as_str())
                    .unwrap_or("Top Charts")
                    .to_string();

                let mut items = Vec::new();
                if let Some(contents) = renderer.get("contents").and_then(|c| c.as_array()) {
                    for item in contents {
                        let mut track_items = Vec::new();
                        collect_track_items(item, &mut track_items);
                        items.extend(track_items);
                    }
                }

                if !items.is_empty() {
                    let mut seen = std::collections::HashSet::new();
                    items.retain(|i| seen.insert(i.id.clone()));
                    sections.push(YTSection { title, items });
                }
                return;
            }

            for (_k, v) in map {
                parse_browse_sections(v, sections);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                parse_browse_sections(v, sections);
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub async fn yt_search(query: String, filter: Option<String>) -> Result<Vec<YTTrackItem>, String> {
    let cache_key = format!("{}|{}", query, filter.as_deref().unwrap_or(""));
    {
        let cache = get_search_cache().lock().unwrap();
        if let Some((items, at)) = cache.get(&cache_key) {
            if at.elapsed() < METADATA_CACHE_TTL {
                return Ok(items.clone());
            }
        }
    }

    let mut body = get_web_remix_context();
    body["query"] = serde_json::Value::String(query);

    if let Some(f) = filter {
        let f_lower = f.to_lowercase();
        let param = match f_lower.as_str() {
            "songs" | "song" => "Eg-KAQwIARAAGAAgACgAMABqChAEEAMQCRAFEAo%3D",
            "videos" | "video" => "Eg-KAQwIAhABGAAgACgAMABqChAEEAMQCRAFEAo%3D",
            "albums" | "album" => "Eg-KAQwBAhABGAAgACgAMABqChAEEAMQCRAFEAo%3D",
            "playlists" | "playlist" => "Eg-KAQwIABAAGAAgACgAMABqChAEEAMQCRAFEAo%3D",
            other => other,
        };
        body["params"] = serde_json::Value::String(param.to_string());
    }

    let resp = innertube_post("search", body).await?;
    let mut items = Vec::new();
    collect_track_items(&resp, &mut items);

    let mut seen = std::collections::HashSet::new();
    items.retain(|item| seen.insert(item.id.clone()));

    get_search_cache()
        .lock()
        .unwrap()
        .insert(cache_key, (items.clone(), Instant::now()));

    Ok(items)
}

#[tauri::command]
pub async fn yt_get_explore() -> Result<YTExploreData, String> {
    {
        let cache = get_explore_cache().lock().unwrap();
        if let Some((data, at)) = cache.as_ref() {
            if at.elapsed() < METADATA_CACHE_TTL {
                return Ok(data.clone());
            }
        }
    }

    let mut body = get_web_remix_context();
    body["browseId"] = serde_json::Value::String("FEmusic_explore".to_string());

    let mut resp = innertube_post("browse", body).await;
    if resp.is_err() {
        let mut fallback_body = get_web_remix_context();
        fallback_body["browseId"] = serde_json::Value::String("FEmusic_charts".to_string());
        resp = innertube_post("browse", fallback_body).await;
    }
    let val = resp?;

    let mut sections = Vec::new();
    parse_browse_sections(&val, &mut sections);

    if sections.is_empty() {
        let mut charts_body = get_web_remix_context();
        charts_body["browseId"] = serde_json::Value::String("FEmusic_charts".to_string());
        if let Ok(charts_val) = innertube_post("browse", charts_body).await {
            parse_browse_sections(&charts_val, &mut sections);
        }
    }

    let data = YTExploreData { sections };
    *get_explore_cache().lock().unwrap() = Some((data.clone(), Instant::now()));
    Ok(data)
}

#[tauri::command]
pub async fn yt_get_radio(video_id: String) -> Result<Vec<YTTrackItem>, String> {
    let clean_id = video_id
        .trim()
        .strip_prefix("yt:")
        .or_else(|| video_id.trim().strip_prefix("yt_"))
        .unwrap_or(video_id.trim())
        .to_string();

    let mut body = get_web_remix_context();
    body["videoId"] = serde_json::Value::String(clean_id.clone());
    // Without an explicit radio playlist id, /next only returns the seed video
    // (a single playlistPanelVideoRenderer). "RDAMVM<videoId>" asks YouTube
    // Music for the auto-generated radio queue instead.
    body["playlistId"] = serde_json::Value::String(format!("RDAMVM{}", clean_id));

    let resp = innertube_post("next", body).await?;
    let mut items = Vec::new();
    collect_track_items(&resp, &mut items);

    let mut seen = std::collections::HashSet::new();
    items.retain(|item| seen.insert(item.id.clone()));

    Ok(items)
}

struct YTDlpPlaylistResult {
    tracks: Vec<YTTrackItem>,
    title: Option<String>,
    author: Option<String>,
}

async fn fetch_playlist_tracks_via_ytdlp(
    app: &tauri::AppHandle,
    clean_playlist_id: &str,
) -> Result<YTDlpPlaylistResult, String> {
    let tools_dir = crate::tools::get_tools_dir(app);
    let yt_dlp_tool = if cfg!(windows) {
        tools_dir.join("yt-dlp.exe")
    } else {
        tools_dir.join("yt-dlp")
    };

    let executable = if yt_dlp_tool.exists() {
        yt_dlp_tool
    } else {
        std::path::PathBuf::from(if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        })
    };

    let raw_id = clean_playlist_id
        .strip_prefix("VL")
        .unwrap_or(clean_playlist_id);
    let target_list = if raw_id == "LM" || raw_id == "FEmusic_liked_videos" {
        "LL"
    } else {
        raw_id
    };

    let saved_cookie = saved_yt_cookie(app);
    let mut cookie_temp_path = None;

    if let Some(ref cookie_str) = saved_cookie {
        let path = std::env::temp_dir().join(format!(
            "stave-ytdlp-pl-{}-{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let netscape = crate::commands::yt_auth::cookie_header_to_netscape(cookie_str);
        if std::fs::write(&path, netscape).is_ok() {
            cookie_temp_path = Some(path);
        }
    }

    let mut cmd = tokio::process::Command::new(&executable);
    cmd.arg("--flat-playlist")
        .arg("--dump-json")
        .arg("--no-warnings")
        .arg("--socket-timeout")
        .arg("15");

    if let Some(ref cpath) = cookie_temp_path {
        cmd.arg("--cookies").arg(cpath);
    } else {
        let candidates = crate::commands::yt_auth::get_browser_cookie_candidates("auto");
        if let Some(candidate) = candidates.first() {
            cmd.arg("--cookies-from-browser").arg(candidate);
        }
    }

    let target_url = format!("https://www.youtube.com/playlist?list={}", target_list);
    cmd.arg(target_url);

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd.kill_on_drop(true);

    let output = tokio::time::timeout(Duration::from_secs(25), cmd.output())
        .await
        .map_err(|_| "yt-dlp playlist tracks timed out".to_string())?
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if let Some(ref cpath) = cookie_temp_path {
        let _ = std::fs::remove_file(cpath);
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp playlist tracks failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut tracks = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut playlist_title: Option<String> = None;
    let mut playlist_author: Option<String> = None;

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            if playlist_title.is_none() {
                playlist_title = val.get("playlist_title").and_then(|v| v.as_str()).map(str::to_string);
            }
            if playlist_author.is_none() {
                playlist_author = val
                    .get("playlist_uploader")
                    .or_else(|| val.get("playlist_channel"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
            }

            let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let title = val.get("title").and_then(|v| v.as_str()).unwrap_or("");
            if !id.is_empty() && !title.is_empty() && seen.insert(id.to_string()) {
                let artist = val
                    .get("uploader")
                    .or_else(|| val.get("channel"))
                    .or_else(|| val.get("artist"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown Artist")
                    .to_string();
                let duration_secs = val
                    .get("duration")
                    .and_then(|v| v.as_f64().map(|f| f as u32).or_else(|| v.as_u64().map(|u| u as u32)))
                    .unwrap_or(0);
                let thumbnail_url = extract_thumbnail(&val)
                    .or_else(|| val.pointer("/thumbnails/0/url").or_else(|| val.get("thumbnail")).and_then(|v| v.as_str()).map(str::to_string));

                tracks.push(YTTrackItem {
                    id: id.to_string(),
                    title: title.to_string(),
                    artist,
                    duration_secs,
                    thumbnail_url,
                });
            }
        }
    }

    if tracks.is_empty() {
        return Err("No tracks extracted from playlist".to_string());
    }

    Ok(YTDlpPlaylistResult {
        tracks,
        title: playlist_title,
        author: playlist_author,
    })
}

#[tauri::command]
pub async fn yt_get_playlist(
    app: tauri::AppHandle,
    playlist_id: String,
) -> Result<YTPlaylistDetails, String> {
    let clean_playlist_id = playlist_id.trim();
    let browse_id = if clean_playlist_id == "LL" || clean_playlist_id == "LM" {
        "FEmusic_liked_videos".to_string()
    } else if clean_playlist_id.starts_with("VL")
        || clean_playlist_id.starts_with("FE")
        || clean_playlist_id.starts_with("MPRE")
        || clean_playlist_id.starts_with("UC")
    {
        clean_playlist_id.to_string()
    } else {
        format!("VL{}", clean_playlist_id)
    };

    let mut body = get_web_remix_context();
    body["browseId"] = serde_json::Value::String(browse_id);

    // Private/user-owned playlists (Liked Music, personal playlists) are only
    // returned when the request is made with the signed-in session. Anonymous
    // browse calls answer 200 with an empty shelf, which made these playlists
    // look broken. Fall back to the anonymous client for public playlists.
    let mut resp = match authenticated_ytmusic_post(&app, "browse", body.clone()).await {
        Ok(response) => response,
        Err(_) => innertube_post("browse", body.clone()).await.unwrap_or_default(),
    };

    let mut tracks = Vec::new();
    let mut fallback_title: Option<String> = None;
    let mut fallback_author: Option<String> = None;

    collect_track_items(&resp, &mut tracks);
    if tracks.is_empty() {
        if let Ok(anon) = innertube_post("browse", body.clone()).await {
            let mut anon_tracks = Vec::new();
            collect_track_items(&anon, &mut anon_tracks);
            if !anon_tracks.is_empty() {
                resp = anon;
                tracks = anon_tracks;
            }
        }
    }

    if tracks.is_empty() {
        if let Ok(ytdlp_res) = fetch_playlist_tracks_via_ytdlp(&app, clean_playlist_id).await {
            tracks = ytdlp_res.tracks;
            fallback_title = ytdlp_res.title;
            fallback_author = ytdlp_res.author;
        }
    }

    let header = resp
        .pointer("/header/musicDetailHeaderRenderer")
        .or_else(|| resp.pointer("/header/musicResponsiveHeaderRenderer"))
        .or_else(|| resp.pointer("/header/musicEditablePlaylistDetailHeaderRenderer"));

    let mut title = header
        .and_then(|h| h.pointer("/title/runs/0/text"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or(fallback_title)
        .unwrap_or_else(|| "Playlist".to_string());

    if title == "Playlist" {
        if let Some((cached_playlists, _)) = get_account_playlist_cache().lock().unwrap().as_ref() {
            if let Some(found) = cached_playlists.iter().find(|p| {
                p.playlist_id == clean_playlist_id
                    || format!("VL{}", p.playlist_id) == clean_playlist_id
                    || clean_playlist_id.strip_prefix("VL").unwrap_or(clean_playlist_id) == p.playlist_id
            }) {
                title = found.title.clone();
            }
        }
    }

    let author = header
        .and_then(|h| {
            h.pointer("/subtitle/runs/0/text")
                .or_else(|| h.pointer("/straplineTextOne/runs/0/text"))
        })
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or(fallback_author);

    let description = header
        .and_then(|h| h.pointer("/description/runs/0/text"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let thumbnail_url = header.and_then(extract_thumbnail).or_else(|| {
        tracks.first().and_then(|t| t.thumbnail_url.clone())
    });

    let mut seen = std::collections::HashSet::new();
    tracks.retain(|item| seen.insert(item.id.clone()));

    let track_count = tracks.len();

    Ok(YTPlaylistDetails {
        id: playlist_id,
        title,
        author,
        description,
        thumbnail_url,
        track_count,
        tracks,
    })
}

fn parse_library_playlist(renderer: &serde_json::Value) -> Option<YTLibraryPlaylist> {
    let playlist_id = renderer
        .pointer("/navigationEndpoint/browseEndpoint/browseId")
        .or_else(|| renderer.pointer("/title/runs/0/navigationEndpoint/browseEndpoint/browseId"))
        .or_else(|| renderer.pointer("/navigationEndpoint/watchPlaylistEndpoint/playlistId"))
        .and_then(|v| v.as_str())?
        .to_string();
    if playlist_id.is_empty() {
        return None;
    }

    let title = renderer
        .pointer("/title/runs/0/text")
        .or_else(|| renderer.pointer("/title/simpleText"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| {
            let text = get_runs_text(renderer.pointer("/title/runs"));
            (!text.is_empty()).then_some(text)
        })?;
    if title.trim().is_empty() {
        return None;
    }

    let subtitle = renderer
        .pointer("/subtitle/runs")
        .and_then(|runs| {
            let text = get_runs_text(Some(runs));
            (!text.is_empty()).then_some(text)
        })
        .or_else(|| {
            renderer
                .pointer("/subtitle/simpleText")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        });

    Some(YTLibraryPlaylist {
        playlist_id,
        title,
        thumbnail_url: extract_thumbnail(renderer),
        subtitle,
    })
}

fn collect_library_playlists(value: &serde_json::Value, out: &mut Vec<YTLibraryPlaylist>) {
    match value {
        serde_json::Value::Object(map) => {
            for key in [
                "musicTwoRowItemRenderer",
                "musicResponsiveListItemRenderer",
                "gridPlaylistRenderer",
                "playlistRenderer",
            ] {
                if let Some(renderer) = map.get(key) {
                    if let Some(playlist) = parse_library_playlist(renderer) {
                        out.push(playlist);
                        return;
                    }
                }
            }
            for nested in map.values() {
                collect_library_playlists(nested, out);
            }
        }
        serde_json::Value::Array(items) => {
            for nested in items {
                collect_library_playlists(nested, out);
            }
        }
        _ => {}
    }
}

fn find_continuation(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(token) = map.get("continuation").and_then(|v| v.as_str()) {
                return Some(token.to_string());
            }
            if let Some(token) = value
                .pointer("/continuationEndpoint/continuationCommand/token")
                .and_then(|v| v.as_str())
            {
                return Some(token.to_string());
            }
            map.values().find_map(find_continuation)
        }
        serde_json::Value::Array(items) => items.iter().find_map(find_continuation),
        _ => None,
    }
}

async fn fetch_playlists_via_oauth(access_token: &str) -> Result<Vec<YTLibraryPlaylist>, String> {
    let url = "https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50";
    let client = innertube_client();
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("OAuth playlists request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("OAuth playlists error status: {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut playlists = Vec::new();
    if let Some(items) = json.get("items").and_then(|v| v.as_array()) {
        for item in items {
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let snippet = item.get("snippet");
            let title = snippet
                .and_then(|s| s.get("title"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !id.is_empty() && !title.is_empty() {
                let thumbnail_url = snippet
                    .and_then(|s| {
                        s.pointer("/thumbnails/maxres/url")
                            .or_else(|| s.pointer("/thumbnails/standard/url"))
                            .or_else(|| s.pointer("/thumbnails/high/url"))
                            .or_else(|| s.pointer("/thumbnails/medium/url"))
                            .or_else(|| s.pointer("/thumbnails/default/url"))
                    })
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let item_count = item
                    .pointer("/contentDetails/itemCount")
                    .and_then(|v| v.as_u64());
                let subtitle = item_count.map(|c| format!("{} tracks", c));
                playlists.push(YTLibraryPlaylist {
                    playlist_id: id.to_string(),
                    title: title.to_string(),
                    thumbnail_url,
                    subtitle,
                });
            }
        }
    }
    Ok(playlists)
}

async fn fetch_feed_playlists_via_ytdlp(
    app: &tauri::AppHandle,
) -> Result<Vec<YTLibraryPlaylist>, String> {
    let tools_dir = crate::tools::get_tools_dir(app);
    let yt_dlp_tool = if cfg!(windows) {
        tools_dir.join("yt-dlp.exe")
    } else {
        tools_dir.join("yt-dlp")
    };

    let executable = if yt_dlp_tool.exists() {
        yt_dlp_tool
    } else {
        std::path::PathBuf::from(if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        })
    };

    let saved_cookie = saved_yt_cookie(app);
    let mut cookie_temp_path = None;

    if let Some(ref cookie_str) = saved_cookie {
        let path = std::env::temp_dir().join(format!(
            "stave-ytdlp-feed-{}-{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let netscape = crate::commands::yt_auth::cookie_header_to_netscape(cookie_str);
        if std::fs::write(&path, netscape).is_ok() {
            cookie_temp_path = Some(path);
        }
    }

    let mut cmd = tokio::process::Command::new(&executable);
    cmd.arg("--flat-playlist")
        .arg("--dump-json")
        .arg("--no-warnings")
        .arg("--socket-timeout")
        .arg("15");

    if let Some(ref cpath) = cookie_temp_path {
        cmd.arg("--cookies").arg(cpath);
    } else {
        let candidates = crate::commands::yt_auth::get_browser_cookie_candidates("auto");
        if let Some(candidate) = candidates.first() {
            cmd.arg("--cookies-from-browser").arg(candidate);
        }
    }

    cmd.arg("https://www.youtube.com/feed/playlists");

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd.kill_on_drop(true);

    let output = tokio::time::timeout(Duration::from_secs(20), cmd.output())
        .await
        .map_err(|_| "yt-dlp feed playlists timed out".to_string())?
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if let Some(ref cpath) = cookie_temp_path {
        let _ = std::fs::remove_file(cpath);
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp feed playlists failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut playlists = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let title = val.get("title").and_then(|v| v.as_str()).unwrap_or("");
            if !id.is_empty() && !title.is_empty() && seen.insert(id.to_string()) {
                let thumbnail_url = extract_thumbnail(&val)
                    .or_else(|| val.pointer("/thumbnails/0/url").or_else(|| val.get("thumbnail")).and_then(|v| v.as_str()).map(str::to_string));
                let playlist_count = val.get("playlist_count").and_then(|v| v.as_u64());
                let subtitle = playlist_count.map(|c| format!("{} tracks", c));
                playlists.push(YTLibraryPlaylist {
                    playlist_id: id.to_string(),
                    title: title.to_string(),
                    thumbnail_url,
                    subtitle,
                });
            }
        }
    }

    if playlists.is_empty() {
        return Err("No playlists found via yt-dlp".to_string());
    }

    Ok(playlists)
}

#[tauri::command]
pub async fn yt_get_account_playlists(
    app: tauri::AppHandle,
) -> Result<Vec<YTLibraryPlaylist>, String> {
    {
        let cache = get_account_playlist_cache().lock().unwrap();
        if let Some((playlists, at)) = cache.as_ref() {
            if at.elapsed() < ACCOUNT_PLAYLIST_CACHE_TTL {
                return Ok(playlists.clone());
            }
        }
    }

    // Tier 1: OAuth token (if signed in via Google OAuth)
    if let Some(account) = saved_yt_account(&app) {
        if let Some(token) = account.access_token.filter(|t| !t.trim().is_empty()) {
            if account.cookies.is_none()
                || !crate::commands::yt_auth::has_yt_auth_cookie(
                    account.cookies.as_deref().unwrap_or(""),
                )
            {
                if let Ok(oauth_playlists) = fetch_playlists_via_oauth(&token).await {
                    if !oauth_playlists.is_empty() {
                        *get_account_playlist_cache().lock().unwrap() =
                            Some((oauth_playlists.clone(), Instant::now()));
                        return Ok(oauth_playlists);
                    }
                }
            }
        }
    }

    // Tier 2: Authenticated InnerTube browse
    let mut body = get_web_remix_context();
    body["browseId"] = serde_json::Value::String("FEmusic_liked_playlists".to_string());
    let mut playlists = Vec::new();

    if let Ok(mut response) = authenticated_ytmusic_post(&app, "browse", body.clone()).await {
        let mut seen_tokens = std::collections::HashSet::new();

        for _ in 0..40 {
            let before = playlists.len();
            collect_library_playlists(&response, &mut playlists);
            if playlists.len() == before {
                break;
            }
            let Some(token) = find_continuation(&response) else {
                break;
            };
            if !seen_tokens.insert(token.clone()) {
                break;
            }
            body["continuation"] = serde_json::Value::String(token);
            if let Ok(next_resp) = authenticated_ytmusic_post(&app, "browse", body.clone()).await {
                response = next_resp;
            } else {
                break;
            }
        }
    }

    // Tier 3: yt-dlp feed playlists fallback if InnerTube returned 0 playlists
    if playlists.is_empty() {
        if let Ok(ytdlp_playlists) = fetch_feed_playlists_via_ytdlp(&app).await {
            playlists = ytdlp_playlists;
        }
    }

    if playlists.is_empty() {
        return Err("No playlists found in your YouTube account. Please make sure you are signed in.".to_string());
    }

    let mut seen_ids = std::collections::HashSet::new();
    playlists.retain(|playlist| seen_ids.insert(playlist.playlist_id.clone()));

    *get_account_playlist_cache().lock().unwrap() = Some((playlists.clone(), Instant::now()));
    Ok(playlists)
}

static PROXY_PORT: OnceLock<u16> = OnceLock::new();

static MEDIA_TOKEN: OnceLock<String> = OnceLock::new();

/// Random per-launch token embedded in loopback URLs. Without it, any local web
/// page could call `/local?path=...` and read arbitrary files from disk.
fn media_token() -> &'static str {
    MEDIA_TOKEN.get_or_init(|| {
        use std::collections::hash_map::RandomState;

        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos() as u64)
            .unwrap_or(0);

        let mut token = String::with_capacity(32);
        for salt in 0..2u64 {
            let mut hasher = RandomState::new().build_hasher();
            hasher.write_u64(nanos ^ salt.wrapping_mul(0x9E37_79B9_7F4A_7C15));
            hasher.write_u32(std::process::id());
            token.push_str(&format!("{:016x}", hasher.finish()));
        }
        token
    })
}

static PROXY_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn proxy_http_client() -> &'static reqwest::Client {
    PROXY_HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
            .http1_only()
            .pool_idle_timeout(Duration::from_secs(30))
            .build()
            .expect("failed to build stream proxy HTTP client")
    })
}

pub fn get_stream_proxy_port() -> u16 {
    *PROXY_PORT.get().unwrap_or(&0)
}

/// Base URL of the loopback media server. Used by the audio engine to stream
/// local files with byte-range support instead of reading whole files into memory.
#[tauri::command]
pub fn media_proxy_base_url() -> String {
    let port = get_stream_proxy_port();
    if port == 0 {
        return String::new();
    }
    format!("http://127.0.0.1:{}/{}", port, media_token())
}

pub async fn start_stream_proxy(app: tauri::AppHandle) {
    if PROXY_PORT.get().is_some() {
        return;
    }

    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[StreamProxy] Failed to bind local TCP listener: {}", e);
            return;
        }
    };

    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    let _ = PROXY_PORT.set(port);
    println!("[StreamProxy] Audio proxy running on 127.0.0.1:{}", port);

    loop {
        let (mut socket, _) = match listener.accept().await {
            Ok(s) => s,
            Err(_) => continue,
        };

        let app_handle = app.clone();
        tokio::spawn(async move {
            let _ = handle_proxy_connection(&mut socket, app_handle).await;
        });
    }
}

async fn handle_proxy_connection(
    socket: &mut TcpStream,
    app: tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut raw = Vec::with_capacity(4096);
    let mut buf = [0u8; 4096];
    loop {
        let n = socket.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        raw.extend_from_slice(&buf[..n]);
        if raw.windows(4).any(|w| w == b"\r\n\r\n") || raw.len() >= 16 * 1024 {
            break;
        }
    }
    if raw.is_empty() {
        return Ok(());
    }

    let req_str = String::from_utf8_lossy(&raw);
    let first_line = req_str.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Ok(());
    }

    let method = parts[0];
    let path = parts[1];

    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\n\
                    Access-Control-Allow-Origin: *\r\n\
                    Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
                    Access-Control-Allow-Headers: *\r\n\
                    \r\n";
        socket.write_all(resp.as_bytes()).await?;
        return Ok(());
    }

    if method != "GET" && method != "HEAD" {
        let resp = "HTTP/1.1 405 Method Not Allowed\r\n\r\n";
        socket.write_all(resp.as_bytes()).await?;
        return Ok(());
    }

    let token_prefix = format!("/{}/", media_token());
    let route = match path.strip_prefix(&token_prefix) {
        Some(route) => route,
        None => {
            let resp = "HTTP/1.1 403 Forbidden\r\n\r\nInvalid media token";
            socket.write_all(resp.as_bytes()).await?;
            return Ok(());
        }
    };
    let path = format!("/{}", route);

    // Extract Range header if present
    let mut client_range: Option<String> = None;
    for line in req_str.lines() {
        if line.to_lowercase().starts_with("range:") {
            if let Some((_, val)) = line.split_once(':') {
                client_range = Some(val.trim().to_string());
            }
        }
    }

    let query_value = |key: &str| -> Option<String> {
        let query_idx = path.find('?')?;
        for param in path[query_idx + 1..].split('&') {
            if let Some((k, v)) = param.split_once('=') {
                if k == key {
                    return Some(v.to_string());
                }
            }
        }
        None
    };

    // Local library playback. Streaming through this loopback server lets the
    // browser request byte ranges while we read the file in small chunks, instead
    // of buffering an entire FLAC/WAV into the Tauri protocol response.
    if path.starts_with("/local") {
        let local_path = match query_value("path")
            .and_then(|value| urlencoding::decode(&value).ok().map(|v| v.to_string()))
        {
            Some(value) if !value.is_empty() => value,
            _ => {
                let resp = "HTTP/1.1 400 Bad Request\r\n\r\nMissing path";
                socket.write_all(resp.as_bytes()).await?;
                return Ok(());
            }
        };
        return serve_local_audio(socket, &local_path, method, client_range.as_deref()).await;
    }

    // Extract query parameter `id` from path e.g. /stream?id=kJQP7kiw5Fk
    let video_id = query_value("id");

    let video_id = match video_id {
        Some(id) if !id.is_empty() => id,
        _ => {
            let resp = "HTTP/1.1 400 Bad Request\r\n\r\nMissing id";
            socket.write_all(resp.as_bytes()).await?;
            return Ok(());
        }
    };

    // Resolve upstream stream URL
    let upstream_url = match resolve_stream_url_internal(&app, &video_id).await {
        Ok(u) => u,
        Err(e) => {
            let resp = format!(
                "HTTP/1.1 502 Bad Gateway\r\n\r\nStream resolution failed: {}",
                e
            );
            socket.write_all(resp.as_bytes()).await?;
            return Ok(());
        }
    };

    let client = proxy_http_client();

    let mut req = client.get(&upstream_url);

    if let Some(ref r) = client_range {
        req = req.header("Range", r);
    }

    let mut upstream_resp = req.send().await?;
    let status = upstream_resp.status();

    // Refresh once when the selected upstream URL is rejected or unavailable. Signed
    // YouTube URLs can expire or be region/client specific even while our cache is valid.
    if !status.is_success() {
        cache_remove(&app, &video_id);
        if let Ok(fresh_url) = resolve_stream_url_internal(&app, &video_id).await {
            let mut req2 = client.get(&fresh_url);
            if let Some(ref r) = client_range {
                req2 = req2.header("Range", r);
            }
            if let Ok(r2) = req2.send().await {
                upstream_resp = r2;
            }
        }
    }

    let status = upstream_resp.status();
    let status_code = status.as_u16();
    let reason = status.canonical_reason().unwrap_or("OK");

    let content_type = upstream_resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("audio/mp4");

    let content_length = upstream_resp
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|h| h.to_str().ok());

    let content_range = upstream_resp
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|h| h.to_str().ok());

    let accept_ranges = upstream_resp
        .headers()
        .get(reqwest::header::ACCEPT_RANGES)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("bytes");

    let mut resp_header = format!(
        "HTTP/1.1 {} {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n\
         Content-Type: {}\r\n\
         Accept-Ranges: {}\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n",
        status_code, reason, content_type, accept_ranges
    );

    if let Some(cl) = content_length {
        resp_header.push_str(&format!("Content-Length: {}\r\n", cl));
    }
    if let Some(cr) = content_range {
        resp_header.push_str(&format!("Content-Range: {}\r\n", cr));
    }
    resp_header.push_str("\r\n");

    socket.write_all(resp_header.as_bytes()).await?;

    if method == "HEAD" {
        return Ok(());
    }

    // Stream audio body chunks
    while let Some(chunk_res) = upstream_resp.chunk().await.transpose() {
        match chunk_res {
            Ok(chunk) => {
                if socket.write_all(&chunk).await.is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    let _ = socket.flush().await;
    Ok(())
}

fn audio_mime_for_path(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" | "mp4" | "alac" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "wav" | "wave" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "aif" | "aiff" => "audio/aiff",
        "wma" => "audio/x-ms-wma",
        _ => "application/octet-stream",
    }
}

fn parse_byte_range(header: &str, file_size: u64) -> Result<(u64, u64), ()> {
    if file_size == 0 {
        return Err(());
    }

    let value = header.trim().strip_prefix("bytes=").ok_or(())?;
    let (start_raw, end_raw) = value.split_once('-').ok_or(())?;

    let (start, end) = if start_raw.is_empty() {
        let suffix: u64 = end_raw.trim().parse().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        let length = suffix.min(file_size);
        (file_size - length, file_size - 1)
    } else {
        let start: u64 = start_raw.trim().parse().map_err(|_| ())?;
        let end = if end_raw.trim().is_empty() {
            file_size - 1
        } else {
            end_raw
                .trim()
                .parse::<u64>()
                .map_err(|_| ())?
                .min(file_size - 1)
        };
        (start, end)
    };

    if start > end || start >= file_size {
        Err(())
    } else {
        Ok((start, end))
    }
}

async fn serve_local_audio(
    socket: &mut TcpStream,
    file_path: &str,
    method: &str,
    range_header: Option<&str>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = PathBuf::from(file_path);
    let metadata = match tokio::fs::metadata(&path).await {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => {
            let resp = "HTTP/1.1 404 Not Found\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Connection: close\r\n\
                        \r\n";
            socket.write_all(resp.as_bytes()).await?;
            return Ok(());
        }
    };

    let file_size = metadata.len();
    let content_type = audio_mime_for_path(&path);

    let parsed_range = match range_header {
        Some(header) => match parse_byte_range(header, file_size) {
            Ok(range) => Some(range),
            Err(()) => {
                let resp = format!(
                    "HTTP/1.1 416 Range Not Satisfiable\r\n\
                     Access-Control-Allow-Origin: *\r\n\
                     Accept-Ranges: bytes\r\n\
                     Content-Range: bytes */{}\r\n\
                     Connection: close\r\n\
                     \r\n",
                    file_size
                );
                socket.write_all(resp.as_bytes()).await?;
                return Ok(());
            }
        },
        None => None,
    };

    let (start, end, status, reason) = match parsed_range {
        Some((start, end)) => (start, end, 206, "Partial Content"),
        None => (0, file_size.saturating_sub(1), 200, "OK"),
    };
    let content_length = if file_size == 0 { 0 } else { end - start + 1 };

    let mut header = format!(
        "HTTP/1.1 {} {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n\
         Content-Type: {}\r\n\
         Accept-Ranges: bytes\r\n\
         Cache-Control: no-store\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n",
        status, reason, content_type, content_length
    );
    if parsed_range.is_some() {
        header.push_str(&format!(
            "Content-Range: bytes {}-{}/{}\r\n",
            start, end, file_size
        ));
    }
    header.push_str("\r\n");
    socket.write_all(header.as_bytes()).await?;

    if method == "HEAD" || content_length == 0 {
        let _ = socket.flush().await;
        return Ok(());
    }

    let mut file = tokio::fs::File::open(&path).await?;
    if start > 0 {
        file.seek(std::io::SeekFrom::Start(start)).await?;
    }

    let mut remaining = content_length;
    let mut buffer = vec![0u8; 64 * 1024];
    while remaining > 0 {
        let to_read = remaining.min(buffer.len() as u64) as usize;
        let read = file.read(&mut buffer[..to_read]).await?;
        if read == 0 {
            break;
        }
        if socket.write_all(&buffer[..read]).await.is_err() {
            break;
        }
        remaining -= read as u64;
    }

    let _ = socket.flush().await;
    Ok(())
}

fn saved_yt_account(app: &tauri::AppHandle) -> Option<crate::commands::yt_auth::YTAccountInfo> {
    let db = app.try_state::<Arc<Mutex<Connection>>>()?;
    let conn = db.lock().ok()?;
    crate::commands::yt_auth::get_saved_account_session(&conn)
}

fn saved_yt_cookie(app: &tauri::AppHandle) -> Option<String> {
    saved_yt_account(app)?
        .cookies
        .filter(|cookie| crate::commands::yt_auth::has_yt_auth_cookie(cookie))
}

fn sapisid_hash(cookie_header: &str, origin: &str) -> Option<String> {
    let sapisid = cookie_header
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find_map(|(name, value)| {
            if name == "SAPISID" || name == "__Secure-3PAPISID" {
                Some(value)
            } else {
                None
            }
        })?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    let input = format!("{} {} {}", timestamp, sapisid, origin);
    let hash = Sha1::digest(input.as_bytes());
    let hex = hash
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    Some(format!("SAPISIDHASH {}_{}", timestamp, hex))
}

async fn resolve_innertube_stream_url(video_id: &str, cookie: Option<&str>) -> Option<String> {
    let requests = [
        // 1. ANDROID_VR client (consistently returns direct unciphered adaptive streams)
        (
            "https://www.youtube.com/youtubei/v1/player",
            "Mozilla/5.0 (Android; Mobile VR; rv:1.61.48) OculusBrowser/32.0.0.0",
            None,
            None,
            Some("28"),
            Some("1.61.48"),
            serde_json::json!({
                "context": {
                    "client": {
                        "clientName": "ANDROID_VR",
                        "clientVersion": "1.61.48",
                        "deviceModel": "Quest 3",
                        "hl": "en",
                        "gl": "US"
                    }
                },
                "videoId": video_id
            }),
        ),
        // 2. IOS client
        (
            "https://www.youtube.com/youtubei/v1/player",
            "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; US)",
            None,
            None,
            Some("5"),
            Some("19.29.1"),
            serde_json::json!({
                "context": {
                    "client": {
                        "clientName": "IOS",
                        "clientVersion": "19.29.1",
                        "deviceModel": "iPhone16,2",
                        "hl": "en",
                        "gl": "US"
                    }
                },
                "videoId": video_id
            }),
        ),
        // 3. ANDROID client
        (
            "https://www.youtube.com/youtubei/v1/player",
            "com.google.android.youtube/19.09.37 (Linux; U; Android 11; US) gzip",
            None,
            None,
            Some("3"),
            Some("19.09.37"),
            serde_json::json!({
                "context": {
                    "client": {
                        "clientName": "ANDROID",
                        "clientVersion": "19.09.37",
                        "androidSdkVersion": 30,
                        "hl": "en",
                        "gl": "US"
                    }
                },
                "videoId": video_id
            }),
        ),
        // 4. TVHTML5_SIMPLY_EMBEDDED_PLAYER
        (
            "https://www.youtube.com/youtubei/v1/player",
            "Mozilla/5.0 (PlayStation; PlayStation 4/10.01) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15",
            Some("https://www.youtube.com/tv"),
            None,
            None,
            None,
            serde_json::json!({
                "context": {
                    "client": {
                        "clientName": "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
                        "clientVersion": "2.0",
                        "hl": "en",
                        "gl": "US"
                    },
                    "thirdParty": {
                        "embedUrl": "https://www.youtube.com"
                    }
                },
                "videoId": video_id
            }),
        ),
        // 5. WEB_REMIX
        (
            "https://music.youtube.com/youtubei/v1/player",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Some("https://music.youtube.com/"),
            Some("https://music.youtube.com"),
            None,
            None,
            serde_json::json!({
                "context": {
                    "client": {
                        "clientName": "WEB_REMIX",
                        "clientVersion": "1.20240101.01.00",
                        "hl": "en",
                        "gl": "US"
                    }
                },
                "videoId": video_id
            }),
        ),
    ];

    for (url, ua, referer, origin, client_name, client_version, body) in requests {
        let mut req = innertube_client()
            .post(url)
            .timeout(Duration::from_secs(6))
            .header("Content-Type", "application/json")
            .header("User-Agent", ua);

        if let Some(cookie) = cookie {
            let origin = if url.contains("music.youtube.com") {
                "https://music.youtube.com"
            } else {
                "https://www.youtube.com"
            };
            req = req.header("Cookie", cookie);
            if let Some(auth) = sapisid_hash(cookie, origin) {
                req = req
                    .header("Authorization", auth)
                    .header("X-Goog-AuthUser", "0");
            }
        }

        if let Some(r) = referer {
            req = req.header("Referer", r);
        }
        if let Some(o) = origin {
            req = req.header("Origin", o);
        }
        if let Some(cn) = client_name {
            req = req.header("X-YouTube-Client-Name", cn);
        }
        if let Some(cv) = client_version {
            req = req.header("X-YouTube-Client-Version", cv);
        }

        let resp = match req.json(&body).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };

        let json: serde_json::Value = match resp.json().await {
            Ok(j) => j,
            Err(_) => continue,
        };

        let mut candidates: Vec<(i64, String)> = Vec::new();

        let mut check_formats = |formats: &serde_json::Value| {
            if let Some(arr) = formats.as_array() {
                for fmt in arr {
                    let mime_type = fmt.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
                    let bitrate = fmt.get("bitrate").and_then(|b| b.as_i64()).unwrap_or(0);

                    // Strictly accept direct unciphered URLs.
                    // Raw URLs in signatureCipher without deciphering will 403 Forbidden!
                    if let Some(stream_url) = fmt.get("url").and_then(|u| u.as_str()) {
                        if !stream_url.is_empty() {
                            if mime_type.starts_with("audio/mp4") {
                                candidates.push((10_000_000 + bitrate, stream_url.to_string()));
                            } else if mime_type.starts_with("audio/") {
                                candidates.push((1_000_000 + bitrate, stream_url.to_string()));
                            }
                        }
                    }
                }
            }
        };

        if let Some(adaptive) = json.pointer("/streamingData/adaptiveFormats") {
            check_formats(adaptive);
        }
        if let Some(formats) = json.pointer("/streamingData/formats") {
            check_formats(formats);
        }

        if !candidates.is_empty() {
            candidates.sort_by(|a, b| b.0.cmp(&a.0));
            return Some(candidates[0].1.clone());
        }
    }

    None
}

async fn resolve_piped_stream_url(video_id: &str) -> Option<String> {
    let instances = [
        "https://pipedapi.kavin.rocks",
        "https://api.piped.privacydev.net",
        "https://pipedapi.tokhmi.xyz",
        "https://pa.il.ax",
    ];

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .ok()?;

    for base in &instances {
        let url = format!("{}/streams/{}", base, video_id);
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(streams) = json.get("audioStreams").and_then(|s| s.as_array()) {
                        let mut candidates: Vec<(i64, String)> = Vec::new();
                        for s in streams {
                            if let Some(stream_url) = s.get("url").and_then(|u| u.as_str()) {
                                let bitrate =
                                    s.get("bitrate").and_then(|b| b.as_i64()).unwrap_or(0);
                                let mime = s.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
                                if mime.contains("mp4") || mime.contains("m4a") {
                                    candidates.push((10_000_000 + bitrate, stream_url.to_string()));
                                } else {
                                    candidates.push((1_000_000 + bitrate, stream_url.to_string()));
                                }
                            }
                        }
                        if !candidates.is_empty() {
                            candidates.sort_by(|a, b| b.0.cmp(&a.0));
                            return Some(candidates[0].1.clone());
                        }
                    }
                }
            }
        }
    }

    None
}

async fn resolve_invidious_stream_url(video_id: &str) -> Option<String> {
    let instances = [
        "https://inv.nadeko.net",
        "https://invidious.nerdvpn.de",
        "https://vid.puffyan.us",
    ];

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .ok()?;

    for base in &instances {
        let url = format!("{}/api/v1/videos/{}", base, video_id);
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(formats) = json.get("adaptiveFormats").and_then(|f| f.as_array()) {
                        let mut candidates: Vec<(i64, String)> = Vec::new();
                        for f in formats {
                            let type_str = f.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            if type_str.starts_with("audio/") {
                                if let Some(stream_url) = f.get("url").and_then(|u| u.as_str()) {
                                    let bitrate =
                                        f.get("bitrate").and_then(|b| b.as_i64()).unwrap_or(0);
                                    if type_str.contains("mp4") || type_str.contains("m4a") {
                                        candidates
                                            .push((10_000_000 + bitrate, stream_url.to_string()));
                                    } else {
                                        candidates
                                            .push((1_000_000 + bitrate, stream_url.to_string()));
                                    }
                                }
                            }
                        }
                        if !candidates.is_empty() {
                            candidates.sort_by(|a, b| b.0.cmp(&a.0));
                            return Some(candidates[0].1.clone());
                        }
                    }
                }
            }
        }
    }

    None
}

async fn run_ytdlp_once(
    executable: &std::path::Path,
    video_id: &str,
    cookie: Option<&str>,
    fast_client: bool,
) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(executable);
    cmd.arg("-g")
        .arg("-f")
        .arg("bestaudio[ext=m4a]/bestaudio")
        .arg("--no-warnings")
        .arg("--no-playlist")
        .arg("--socket-timeout")
        .arg("10");
    if fast_client {
        // `visionos` skips several of the clients yt-dlp tries by default and
        // consistently returns format 140 about 1-2s faster in practice.
        cmd.arg("--extractor-args")
            .arg("youtube:player_client=visionos");
    }
    cmd.arg(format!("https://www.youtube.com/watch?v={}", video_id));
    if let Some(cookie) = cookie {
        cmd.arg("--add-headers").arg(format!("Cookie: {}", cookie));
    }

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    cmd.kill_on_drop(true);

    let output = tokio::time::timeout(Duration::from_secs(25), cmd.output())
        .await
        .map_err(|_| "yt-dlp timed out".to_string())?
        .map_err(|e| format!("Failed to run yt-dlp: {}. Make sure yt-dlp is installed.", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(|s| s.trim())
        .find(|s| s.starts_with("http://") || s.starts_with("https://"))
        .map(str::to_string)
        .ok_or_else(|| "yt-dlp returned no stream URL".to_string())
}

async fn resolve_ytdlp_stream_url(
    app: &tauri::AppHandle,
    video_id: &str,
    cookie: Option<&str>,
) -> Result<String, String> {
    let tools_dir = crate::tools::get_tools_dir(app);
    let yt_dlp_tool = if cfg!(windows) {
        tools_dir.join("yt-dlp.exe")
    } else {
        tools_dir.join("yt-dlp")
    };

    let executable = if yt_dlp_tool.exists() {
        yt_dlp_tool
    } else {
        std::path::PathBuf::from(if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        })
    };

    // Anonymous extraction is both faster (no cookie header parsing/scoping)
    // and more reliable than replaying a browser cookie jar, so try it first
    // and only fall back to the signed-in cookies if that fails.
    match run_ytdlp_once(&executable, video_id, None, true).await {
        Ok(url) => Ok(url),
        Err(first_error) => {
            // Retry with yt-dlp's full default client rotation before giving up
            // on anonymous extraction, since `visionos` is not supported for
            // every video.
            if let Ok(url) = run_ytdlp_once(&executable, video_id, None, false).await {
                return Ok(url);
            }
            if let Some(cookie) = cookie {
                if let Ok(url) = run_ytdlp_once(&executable, video_id, Some(cookie), false).await {
                    return Ok(url);
                }
            }
            Err(first_error)
        }
    }
}

fn cache_lookup(app: &tauri::AppHandle, video_id: &str) -> Option<String> {
    if let Some(url) = memory_cache_lookup(video_id) {
        return Some(url);
    }

    // Restarts (and the first play after opening a playlist) can reuse the
    // signed upstream URL persisted by a previous launch.
    if let Some(url) = persisted_cache_lookup(app, video_id) {
        get_stream_cache().lock().unwrap().insert(
            video_id.to_string(),
            (url.clone(), Instant::now()),
        );
        return Some(url);
    }

    None
}

fn cache_store(app: &tauri::AppHandle, video_id: &str, url: &str) {
    get_stream_cache()
        .lock()
        .unwrap()
        .insert(video_id.to_string(), (url.to_string(), Instant::now()));
    persisted_cache_store(app, video_id, url);
}

fn cache_remove(app: &tauri::AppHandle, video_id: &str) {
    get_stream_cache().lock().unwrap().remove(video_id);
    persisted_cache_remove(app, video_id);
}

pub async fn resolve_stream_url_internal(
    app: &tauri::AppHandle,
    video_id: &str,
) -> Result<String, String> {
    let clean_id = video_id
        .trim()
        .strip_prefix("yt:")
        .or_else(|| video_id.trim().strip_prefix("yt_"))
        .unwrap_or(video_id.trim())
        .to_string();

    if clean_id.is_empty() {
        return Err("Invalid or empty video ID".to_string());
    }

    if let Some(url) = cache_lookup(app, &clean_id) {
        return Ok(url);
    }

    // Coalesce concurrent resolutions for the same video onto one task.
    let video_lock = {
        let mut in_flight = get_in_flight_resolves().lock().await;
        in_flight
            .entry(clean_id.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    };
    let _guard = video_lock.lock().await;

    // Another task may have finished while we were waiting for the lock.
    if let Some(url) = cache_lookup(app, &clean_id) {
        let mut in_flight = get_in_flight_resolves().lock().await;
        in_flight.remove(&clean_id);
        return Ok(url);
    }

    let cookie = saved_yt_cookie(app);
    let result = resolve_stream_url_uncached(app, &clean_id, cookie.as_deref()).await;

    {
        let mut in_flight = get_in_flight_resolves().lock().await;
        in_flight.remove(&clean_id);
    }

    if let Ok(url) = &result {
        cache_store(app, &clean_id, url);
    }

    result
}

async fn resolve_stream_url_uncached(
    app: &tauri::AppHandle,
    clean_id: &str,
    cookie: Option<&str>,
) -> Result<String, String> {
    // Tier 1: Local yt-dlp binary. This is currently the only resolver that
    // reliably returns a playable URL (the raw InnerTube endpoints either
    // demand a bot check or hand back ciphered URLs).
    if let Ok(stream_url) = resolve_ytdlp_stream_url(app, clean_id, cookie).await {
        return Ok(stream_url);
    }

    // Tier 2: InnerTube direct player endpoint. Kept as a cheap fallback, but
    // capped so the (currently always-failing) client retries cannot stall
    // playback for tens of seconds.
    if let Ok(Some(stream_url)) = tokio::time::timeout(
        Duration::from_secs(4),
        resolve_innertube_stream_url(clean_id, cookie),
    )
    .await
    {
        return Ok(stream_url);
    }

    // Tier 3: Piped API public resolvers
    if let Ok(Some(stream_url)) =
        tokio::time::timeout(Duration::from_secs(4), resolve_piped_stream_url(clean_id)).await
    {
        return Ok(stream_url);
    }

    // Tier 4: Invidious API public resolvers
    if let Ok(Some(stream_url)) = tokio::time::timeout(
        Duration::from_secs(4),
        resolve_invidious_stream_url(clean_id),
    )
    .await
    {
        return Ok(stream_url);
    }

    Err(format!(
        "Could not resolve stream URL for video {}",
        clean_id
    ))
}

#[tauri::command]
pub async fn yt_get_stream_url(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    let clean_id = video_id
        .trim()
        .strip_prefix("yt:")
        .or_else(|| video_id.trim().strip_prefix("yt_"))
        .unwrap_or(video_id.trim())
        .to_string();

    if clean_id.is_empty() {
        return Err("Invalid or empty video ID".to_string());
    }

    // Resolve *before* replying so the UI's loading state covers the (possibly
    // multi-second) yt-dlp run and the proxy finds a warm cache.
    resolve_stream_url_internal(&app, &clean_id).await?;

    let port = get_stream_proxy_port();
    if port > 0 {
        Ok(format!(
            "http://127.0.0.1:{}/{}/stream?id={}",
            port,
            media_token(),
            clean_id
        ))
    } else {
        resolve_stream_url_internal(&app, &clean_id).await
    }
}
