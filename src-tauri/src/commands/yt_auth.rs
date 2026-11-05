use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::Client;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State, WebviewWindow};

/// Tracks whether a background task is already watching the sign-in window for a
/// completed YouTube Music login, so reopening the window does not spawn duplicates.
static LOGIN_WATCHER_RUNNING: AtomicBool = AtomicBool::new(false);

// Default public Google OAuth client ID for YouTube desktop integration
// Users can also supply their own client ID & secret in Settings
pub const DEFAULT_GOOGLE_CLIENT_ID: &str =
    "861556708465-qhptmr53457hpb595s8j8v4v6bt23m0q.apps.googleusercontent.com";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct YTAccountInfo {
    pub is_authenticated: bool,
    pub name: String,
    pub email: String,
    pub avatar_url: Option<String>,
    pub channel_title: Option<String>,
    pub channel_id: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub cookies: Option<String>,
    pub auth_type: String, // "oauth" or "browser_session"
    pub updated_at: u64,
}

#[allow(dead_code)]
#[derive(Deserialize, Debug)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    token_type: Option<String>,
}

#[derive(Deserialize, Debug)]
struct GoogleUserInfoResponse {
    name: Option<String>,
    email: Option<String>,
    picture: Option<String>,
}

#[derive(Deserialize, Debug)]
struct YouTubeChannelItem {
    id: Option<String>,
    snippet: Option<YouTubeChannelSnippet>,
}

#[derive(Deserialize, Debug)]
struct YouTubeChannelSnippet {
    title: Option<String>,
    thumbnails: Option<serde_json::Value>,
}

#[derive(Deserialize, Debug)]
struct YouTubeChannelsResponse {
    items: Option<Vec<YouTubeChannelItem>>,
}

fn get_now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn get_saved_account_session(conn: &Connection) -> Option<YTAccountInfo> {
    let mut stmt = conn
        .prepare("SELECT value FROM settings WHERE key = 'yt_account_session'")
        .ok()?;
    let val_str: String = stmt.query_row([], |row| row.get(0)).ok()?;
    serde_json::from_str(&val_str).ok()
}

pub fn save_account_session(conn: &Connection, account: &YTAccountInfo) -> Result<(), String> {
    let json_str = serde_json::to_string(account).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('yt_account_session', ?1)",
        [&json_str],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_account_session(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM settings WHERE key = 'yt_account_session'", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Builds a `Cookie` header for YouTube by merging the cookies stored for every
/// YouTube origin. Querying several origins matters on Windows because the auth
/// cookies live on `.youtube.com` while the sign-in window may currently be on
/// `music.youtube.com` or `consent.youtube.com`.
fn youtube_cookie_header(window: &WebviewWindow) -> Result<String, String> {
    let mut seen = std::collections::HashSet::new();
    let mut parts: Vec<String> = Vec::new();
    let mut last_error: Option<String> = None;
    let mut read_any = false;

    for url_str in [
        "https://music.youtube.com/",
        "https://www.youtube.com/",
        "https://youtube.com/",
    ] {
        let Ok(url) = url_str.parse::<tauri::Url>() else {
            continue;
        };
        match window.cookies_for_url(url) {
            Ok(cookies) => {
                read_any = true;
                for cookie in cookies {
                    let name = cookie.name().to_string();
                    if seen.insert(name.clone()) {
                        parts.push(format!("{}={}", name, cookie.value()));
                    }
                }
            }
            Err(error) => last_error = Some(error.to_string()),
        }
    }

    if !read_any {
        return Err(last_error.unwrap_or_else(|| "Could not read YouTube cookies".to_string()));
    }

    Ok(parts.join("; "))
}

/// YouTube only lets requests act as the signed-in user when one of these cookies
/// is present (it is what the `SAPISIDHASH` authorization header is derived from).
pub fn has_yt_auth_cookie(cookie_header: &str) -> bool {
    cookie_header
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .any(|(name, value)| {
            !value.is_empty() && matches!(name.trim(), "SAPISID" | "__Secure-3PAPISID")
        })
}

/// Copies the signed-in YouTube Music WebView session into Stave's account store.
/// Tauri's cookie API includes secure and HttpOnly cookies that page JavaScript cannot read.
pub fn capture_yt_login_session(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
) -> Result<Option<YTAccountInfo>, String> {
    let cookie_header = youtube_cookie_header(window)?;

    if !has_yt_auth_cookie(&cookie_header) {
        return Ok(None);
    }

    let account = YTAccountInfo {
        is_authenticated: true,
        name: "Loading profile".to_string(),
        email: String::new(),
        avatar_url: None,
        channel_title: Some("Signed in with YouTube Music".to_string()),
        channel_id: None,
        access_token: None,
        refresh_token: None,
        cookies: Some(cookie_header),
        auth_type: "webview_session".to_string(),
        updated_at: get_now_secs(),
    };

    let db = app
        .try_state::<Arc<Mutex<Connection>>>()
        .ok_or_else(|| "Database is not available".to_string())?;
    {
        let conn = db
            .lock()
            .map_err(|_| "Database lock is unavailable".to_string())?;
        save_account_session(&conn, &account)?;
        crate::commands::ytmusic::clear_persisted_stream_cache(&conn);
    }
    crate::commands::ytmusic::clear_stream_cache();
    Ok(Some(account))
}

/// Pushes a freshly captured session to the frontend immediately, then upgrades it
/// with the real profile (name/avatar) once YouTube answers. Emitting first means the
/// app is usable even if the profile request is slow or offline.
pub async fn emit_captured_session(app: &tauri::AppHandle, account: YTAccountInfo) {
    crate::commands::ytmusic::clear_metadata_cache();
    let _ = app.emit("yt-auth-session-captured", public_account(account.clone()));

    match refresh_yt_account_profile(app).await {
        Ok(profile) => {
            let _ = app.emit("yt-auth-session-captured", public_account(profile));
        }
        Err(error) => {
            eprintln!("[YouTubeAuth] Could not refresh YouTube profile: {}", error);
        }
    }
}

/// Captures the session and closes the sign-in window. Used both when the user
/// closes the window manually and when the watcher detects a completed login.
pub async fn finalize_yt_login_session(app: &tauri::AppHandle, window: &WebviewWindow) {
    let captured = match capture_yt_login_session(app, window) {
        Ok(Some(account)) => Some(account),
        Ok(None) => {
            eprintln!("[YouTubeAuth] No signed-in YouTube Music session found in the login window");
            None
        }
        Err(error) => {
            eprintln!("[YouTubeAuth] Could not capture sign-in session: {}", error);
            None
        }
    };

    // `close()` would raise CloseRequested again and re-enter the capture path,
    // so tear the WebView down directly.
    let _ = window.destroy();

    if let Some(account) = captured {
        emit_captured_session(app, account).await;
    }
}

/// Watches the sign-in window and finishes the login as soon as YouTube Music has a
/// valid session. Without this the app only noticed a login when the user closed the
/// window, so a successful sign-in looked like "nothing happened".
fn start_yt_login_watcher(app: tauri::AppHandle) {
    if LOGIN_WATCHER_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let started = std::time::Instant::now();

        loop {
            tokio::time::sleep(Duration::from_millis(1200)).await;

            if started.elapsed() > Duration::from_secs(20 * 60) {
                break;
            }

            let Some(window) = app.get_webview_window("yt_login") else {
                break;
            };

            // Only look for cookies once the window has actually reached YouTube.
            // This avoids treating an unrelated Google session as a YouTube login.
            let on_youtube = window
                .url()
                .map(|url| {
                    matches!(url.host_str(), Some(host)
                        if host.ends_with("youtube.com") || host.ends_with("youtube-nocookie.com"))
                })
                .unwrap_or(false);

            if !on_youtube {
                continue;
            }

            if let Ok(Some(_account)) = capture_yt_login_session(&app, &window) {
                // Verify the account actually authenticates with YouTube before destroying the window
                if let Ok(profile) = refresh_yt_account_profile(&app).await {
                    let _ = window.destroy();
                    LOGIN_WATCHER_RUNNING.store(false, Ordering::SeqCst);
                    emit_captured_session(&app, profile).await;
                    break;
                }
            }
        }

        LOGIN_WATCHER_RUNNING.store(false, Ordering::SeqCst);
    });
}

fn find_channel_id(value: &serde_json::Value) -> Option<String> {
    fn walk(value: &serde_json::Value, found: &mut Option<String>) {
        if found.is_some() {
            return;
        }
        match value {
            serde_json::Value::Object(map) => {
                // The account menu renders the signed-in channel as a
                // compactLinkRenderer labelled "Your channel".
                if let Some(link) = map.get("compactLinkRenderer") {
                    let title = link
                        .pointer("/title/runs/0/text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if title.eq_ignore_ascii_case("your channel") {
                        if let Some(id) = link
                            .pointer("/navigationEndpoint/browseEndpoint/browseId")
                            .and_then(|v| v.as_str())
                            .filter(|id| id.starts_with("UC"))
                        {
                            *found = Some(id.to_string());
                            return;
                        }
                    }
                }
                // Generic fallback: any browse endpoint tagged as the user's channel.
                if let Some(page_type) = value
                    .pointer(
                        "/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType",
                    )
                    .and_then(|v| v.as_str())
                {
                    if page_type == "MUSIC_PAGE_TYPE_USER_CHANNEL" {
                        if let Some(id) = value
                            .pointer("/browseId")
                            .and_then(|v| v.as_str())
                            .filter(|id| id.starts_with("UC"))
                        {
                            *found = Some(id.to_string());
                            return;
                        }
                    }
                }
                for child in map.values() {
                    walk(child, found);
                }
            }
            serde_json::Value::Array(items) => {
                for child in items {
                    walk(child, found);
                }
            }
            _ => {}
        }
    }

    let mut found = None;
    walk(value, &mut found);
    found
}

pub async fn refresh_yt_account_profile(app: &tauri::AppHandle) -> Result<YTAccountInfo, String> {
    let body = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        }
    });
    let response =
        crate::commands::ytmusic::authenticated_ytmusic_post(app, "account/account_menu", body)
            .await?;
    let header = response.pointer("/actions/0/openPopupAction/popup/multiPageMenuRenderer/header/activeAccountHeaderRenderer")
        .or_else(|| response.pointer("/actions/0/openPopupAction/popup/multiPageMenuRenderer/header/accountHeaderRenderer"))
        .ok_or_else(|| "YouTube did not return the signed-in account profile".to_string())?;

    let name = header
        .pointer("/accountName/runs/0/text")
        .or_else(|| header.pointer("/accountName/simpleText"))
        .and_then(|v| v.as_str())
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| "YouTube did not return an account name".to_string())?
        .to_string();
    let handle = header
        .pointer("/channelHandle/runs/0/text")
        .or_else(|| header.pointer("/channelHandle/simpleText"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let email = header
        .pointer("/email/runs/0/text")
        .or_else(|| header.pointer("/email/simpleText"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let avatar_url = header
        .pointer("/accountPhoto/thumbnails")
        .and_then(|v| v.as_array())
        .and_then(|items| items.last())
        .and_then(|item| item.get("url"))
        .and_then(|v| v.as_str())
        .map(|url| {
            if url.starts_with("//") {
                format!("https:{}", url)
            } else {
                url.to_string()
            }
        });
    let channel_id = header
        .get("channelId")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| find_channel_id(&response));

    let db = app
        .try_state::<Arc<Mutex<Connection>>>()
        .ok_or_else(|| "Database is not available".to_string())?;
    let mut account = {
        let conn = db
            .lock()
            .map_err(|_| "Database lock is unavailable".to_string())?;
        get_saved_account_session(&conn)
            .ok_or_else(|| "No YouTube Music session is saved".to_string())?
    };
    account.name = name;
    if !email.trim().is_empty() {
        account.email = email;
    }
    if avatar_url.is_some() {
        account.avatar_url = avatar_url;
    }
    if handle.is_some() {
        account.channel_title = handle;
    }
    if channel_id.is_some() {
        account.channel_id = channel_id;
    }
    account.updated_at = get_now_secs();
    {
        let conn = db
            .lock()
            .map_err(|_| "Database lock is unavailable".to_string())?;
        save_account_session(&conn, &account)?;
    }
    Ok(account)
}

fn public_account(mut account: YTAccountInfo) -> YTAccountInfo {
    account.cookies = None;
    account.access_token = None;
    account.refresh_token = None;
    account
}

#[tauri::command]
pub async fn yt_auth_refresh_account_profile(
    app: tauri::AppHandle,
) -> Result<YTAccountInfo, String> {
    refresh_yt_account_profile(&app).await.map(public_account)
}

/// Initiates Google OAuth in default browser with `prompt=select_account` so the user can choose their account
#[tauri::command]
pub async fn yt_auth_start_browser(
    client_id: Option<String>,
    client_secret: Option<String>,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<YTAccountInfo, String> {
    let actual_client_id = client_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_GOOGLE_CLIENT_ID.to_string());

    // 1. Generate PKCE code_verifier & code_challenge
    let code_verifier: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();

    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let code_challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

    // 2. Bind a local TCP listener to capture the OAuth redirect
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind local loopback server: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);
    let scope = "https://www.googleapis.com/auth/youtube.readonly%20https://www.googleapis.com/auth/youtube%20https://www.googleapis.com/auth/userinfo.profile%20https://www.googleapis.com/auth/userinfo.email";

    // 3. Construct OAuth URL with prompt=select_account to let the user pick which account in the browser
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&prompt=select_account&access_type=offline&code_challenge={}&code_challenge_method=S256",
        actual_client_id, redirect_uri, scope, code_challenge
    );

    // 4. Open default system browser
    let _ = open::that(&auth_url);

    // 5. Wait for callback
    let mut auth_code = String::new();
    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                let mut buffer = [0; 4096];
                let bytes_read = stream.read(&mut buffer).unwrap_or(0);
                if bytes_read == 0 {
                    continue;
                }

                let request = String::from_utf8_lossy(&buffer[..bytes_read]);

                if let Some(line) = request.lines().next() {
                    if line.starts_with("GET /callback") {
                        if let Some(code_pos) = line.find("code=") {
                            let rest = &line[code_pos + 5..];
                            let end = rest
                                .find('&')
                                .or_else(|| rest.find(' '))
                                .unwrap_or(rest.len());
                            let raw_code = &rest[..end];
                            if let Ok(decoded) = urlencoding::decode(raw_code) {
                                auth_code = decoded.to_string();
                            } else {
                                auth_code = raw_code.to_string();
                            }
                        }
                    }
                }

                let response_body = r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Connected to Stave</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1012; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1a1b1e; padding: 48px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.08); text-align: center; max-width: 440px; box-shadow: 0 24px 48px rgba(0,0,0,0.6); }
    .badge { display: inline-block; background: rgba(255,0,0,0.15); color: #ff4e4e; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 9999px; margin-bottom: 20px; }
    .icon { width: 64px; height: 64px; background: #22c55e; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 32px; margin-bottom: 20px; color: #fff; }
    h2 { margin: 0 0 12px 0; font-size: 24px; font-weight: 700; }
    p { color: #9ca3af; font-size: 14px; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">YouTube Music</div>
    <div class="icon">&#10003;</div>
    <h2>Signed In Successfully!</h2>
    <p>Your YouTube Music account has been connected to Stave. You can safely close this browser window and return to the app.</p>
  </div>
  <script>setTimeout(function() { window.close(); }, 3500);</script>
</body>
</html>"#;

                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );

                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
                break;
            }
            Err(e) => return Err(format!("Connection error: {}", e)),
        }
    }

    if auth_code.is_empty() {
        return Err("No authorization code received from Google".into());
    }

    // 6. Exchange code for access & refresh tokens
    let client = Client::new();
    let mut form_params = vec![
        ("client_id", actual_client_id.as_str()),
        ("grant_type", "authorization_code"),
        ("code", auth_code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("code_verifier", code_verifier.as_str()),
    ];

    let secret_str;
    if let Some(ref sec) = client_secret {
        if !sec.trim().is_empty() {
            secret_str = sec.trim();
            form_params.push(("client_secret", secret_str));
        }
    }

    let body_str = form_params
        .iter()
        .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let token_res = client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body_str)
        .send()
        .await
        .map_err(|e| format!("Token request network error: {}", e))?;

    if !token_res.status().is_success() {
        let err_body = token_res.text().await.unwrap_or_default();
        return Err(format!("Google token exchange failed: {}", err_body));
    }

    let token_data: GoogleTokenResponse = token_res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Google token JSON: {}", e))?;

    let access_token = token_data.access_token;

    // 7. Fetch user profile from Google UserInfo
    let mut name = "YouTube Music User".to_string();
    let mut email = String::new();
    let mut avatar_url = None;

    if let Ok(info_res) = client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(&access_token)
        .send()
        .await
    {
        if let Ok(info) = info_res.json::<GoogleUserInfoResponse>().await {
            if let Some(n) = info.name {
                name = n;
            }
            if let Some(e) = info.email {
                email = e;
            }
            avatar_url = info.picture;
        }
    }

    // 8. Optionally fetch YouTube Channel info
    let mut channel_title = None;
    let mut channel_id = None;
    if let Ok(yt_res) = client
        .get("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true")
        .bearer_auth(&access_token)
        .send()
        .await
    {
        if let Ok(yt_data) = yt_res.json::<YouTubeChannelsResponse>().await {
            if let Some(items) = yt_data.items {
                if let Some(first) = items.into_iter().next() {
                    channel_id = first.id;
                    if let Some(snippet) = first.snippet {
                        if let Some(t) = snippet.title {
                            channel_title = Some(t);
                        }
                        if avatar_url.is_none() {
                            if let Some(thumbs) = snippet.thumbnails {
                                if let Some(high) = thumbs
                                    .pointer("/high/url")
                                    .or_else(|| thumbs.pointer("/default/url"))
                                    .and_then(|u| u.as_str())
                                {
                                    avatar_url = Some(high.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let account_info = YTAccountInfo {
        is_authenticated: true,
        name,
        email,
        avatar_url,
        channel_title,
        channel_id,
        access_token: Some(access_token),
        refresh_token: token_data.refresh_token,
        cookies: None,
        auth_type: "oauth".to_string(),
        updated_at: get_now_secs(),
    };

    // 9. Persist to database
    {
        let conn = db.lock().unwrap();
        save_account_session(&conn, &account_info)?;
        crate::commands::ytmusic::clear_persisted_stream_cache(&conn);
    }
    crate::commands::ytmusic::clear_stream_cache();

    Ok(public_account(account_info))
}

fn cookies_from_netscape(contents: &str) -> String {
    let mut entries: Vec<(String, String)> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for raw_line in contents.lines() {
        let line = raw_line.trim_end();
        if line.is_empty() {
            continue;
        }
        // yt-dlp prefixes HttpOnly cookies with `#HttpOnly_` in Netscape files.
        let line = line.strip_prefix("#HttpOnly_").unwrap_or(line);
        if line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() < 7 {
            continue;
        }
        let domain = fields[0];
        if !(domain.ends_with("youtube.com") || domain.ends_with("google.com")) {
            continue;
        }
        let name = fields[5].trim();
        let value = fields[6].trim();
        if name.is_empty() || value.is_empty() || !seen.insert(name.to_string()) {
            continue;
        }
        entries.push((name.to_string(), value.to_string()));
    }
    entries
        .into_iter()
        .map(|(name, value)| format!("{}={}", name, value))
        .collect::<Vec<_>>()
        .join("; ")
}

pub fn cookie_header_to_netscape(cookie_header: &str) -> String {
    let mut out = String::from("# Netscape HTTP Cookie File\n# https://curl.se/docs/http-cookies.html\n\n");
    for part in cookie_header.split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((name, value)) = part.split_once('=') {
            let name = name.trim();
            let value = value.trim();
            if !name.is_empty() && !value.is_empty() {
                out.push_str(&format!(
                    ".youtube.com\tTRUE\t/\tTRUE\t2147483647\t{}\t{}\n",
                    name, value
                ));
                if name.contains("SID")
                    || name.contains("SSID")
                    || name.contains("APISID")
                    || name.contains("LOGIN_INFO")
                    || name.starts_with("__Secure")
                {
                    out.push_str(&format!(
                        ".google.com\tTRUE\t/\tTRUE\t2147483647\t{}\t{}\n",
                        name, value
                    ));
                }
            }
        }
    }
    out
}

fn find_gecko_profile(base_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let entries = std::fs::read_dir(base_dir).ok()?;
    let mut default_profile = None;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() && p.join("cookies.sqlite").exists() {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.contains("default") || name.contains("release") {
                return Some(p);
            }
            if default_profile.is_none() {
                default_profile = Some(p);
            }
        }
    }
    default_profile
}

pub fn get_browser_cookie_candidates(browser_name: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let appdata_path = std::path::Path::new(&appdata);

    let clean = browser_name.trim().to_lowercase();
    match clean.as_str() {
        "zen" => {
            if let Some(p) = find_gecko_profile(&appdata_path.join("zen").join("Profiles")) {
                candidates.push(format!("firefox:{}", p.to_string_lossy()));
            }
        }
        "floorp" => {
            if let Some(p) = find_gecko_profile(&appdata_path.join("Floorp").join("Profiles")) {
                candidates.push(format!("firefox:{}", p.to_string_lossy()));
            }
        }
        "firefox" => {
            candidates.push("firefox".to_string());
            if let Some(p) = find_gecko_profile(&appdata_path.join("Mozilla").join("Firefox").join("Profiles")) {
                candidates.push(format!("firefox:{}", p.to_string_lossy()));
            }
        }
        "edge" | "msedge" => {
            candidates.push("edge".to_string());
        }
        "chrome" => {
            candidates.push("chrome".to_string());
        }
        "brave" => {
            candidates.push("brave".to_string());
        }
        "opera" => {
            candidates.push("opera".to_string());
        }
        "vivaldi" => {
            candidates.push("vivaldi".to_string());
        }
        "auto" | "" => {
            // Check Gecko browsers first since their cookie databases are unencrypted SQLite
            if let Some(p) = find_gecko_profile(&appdata_path.join("zen").join("Profiles")) {
                candidates.push(format!("firefox:{}", p.to_string_lossy()));
            }
            if let Some(p) = find_gecko_profile(&appdata_path.join("Mozilla").join("Firefox").join("Profiles")) {
                candidates.push(format!("firefox:{}", p.to_string_lossy()));
            }
            if let Some(p) = find_gecko_profile(&appdata_path.join("Floorp").join("Profiles")) {
                candidates.push(format!("firefox:{}", p.to_string_lossy()));
            }
            candidates.push("edge".to_string());
            candidates.push("chrome".to_string());
            candidates.push("brave".to_string());
            candidates.push("firefox".to_string());
            candidates.push("opera".to_string());
            candidates.push("vivaldi".to_string());
        }
        other => {
            candidates.push(other.to_string());
        }
    }
    candidates
}

/// Connects via browser session cookies using yt-dlp --cookies-from-browser (Chrome, Edge, Firefox, Brave, Zen)
#[tauri::command]
pub async fn yt_auth_sync_browser_cookies(
    app: tauri::AppHandle,
    browser: String,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<YTAccountInfo, String> {
    let tools_dir = crate::tools::get_tools_dir(&app);
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

    let candidates = get_browser_cookie_candidates(&browser);
    let mut last_error = String::new();

    for candidate in &candidates {
        let cookie_path = std::env::temp_dir().join(format!(
            "stave-yt-cookies-{}-{}.txt",
            std::process::id(),
            get_now_secs()
        ));
        let _ = std::fs::remove_file(&cookie_path);

        let mut cmd = tokio::process::Command::new(&executable);
        cmd.arg("--cookies-from-browser")
            .arg(candidate)
            .arg("--cookies")
            .arg(&cookie_path)
            .arg("--simulate")
            .arg("--skip-download")
            .arg("--no-warnings")
            .arg("https://www.youtube.com");

        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let output = match cmd.output().await {
            Ok(out) => out,
            Err(e) => {
                last_error = format!("Failed to run yt-dlp: {}", e);
                continue;
            }
        };

        let cookie_header = std::fs::read_to_string(&cookie_path)
            .map(|contents| cookies_from_netscape(&contents))
            .unwrap_or_default();
        let _ = std::fs::remove_file(&cookie_path);

        if output.status.success() && has_yt_auth_cookie(&cookie_header) {
            let account_info = YTAccountInfo {
                is_authenticated: true,
                name: "YouTube Music".to_string(),
                email: String::new(),
                avatar_url: None,
                channel_title: None,
                channel_id: None,
                access_token: None,
                refresh_token: None,
                cookies: Some(cookie_header),
                auth_type: "browser_session".to_string(),
                updated_at: get_now_secs(),
            };

            {
                let conn = db.lock().unwrap();
                save_account_session(&conn, &account_info)?;
                crate::commands::ytmusic::clear_persisted_stream_cache(&conn);
            }
            crate::commands::ytmusic::clear_stream_cache();

            // Replace the placeholder identity with the real Google profile.
            let account_info = refresh_yt_account_profile(&app)
                .await
                .unwrap_or(account_info);
            crate::commands::ytmusic::clear_metadata_cache();

            return Ok(public_account(account_info));
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = stderr
                .lines()
                .find(|line| line.contains("ERROR") || line.contains("Failed"))
                .unwrap_or("")
                .trim();
            if !detail.is_empty() {
                last_error = detail.to_string();
            }
        }
    }

    Err(format!(
        "Could not find an active signed-in YouTube session in {}. Try signing in to YouTube in your browser or use in-app sign-in. Details: {}",
        browser,
        if last_error.is_empty() { "No auth cookies found" } else { &last_error }
    ))
}

/// Returns the currently saved account session from SQLite
#[tauri::command]
pub fn yt_auth_get_account(
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<Option<YTAccountInfo>, String> {
    let conn = db.lock().unwrap();
    Ok(get_saved_account_session(&conn).map(public_account))
}

/// Logs out the user and clears stored session
#[tauri::command]
pub fn yt_auth_logout(db: State<'_, Arc<Mutex<Connection>>>) -> Result<(), String> {
    let conn = db.lock().unwrap();
    delete_account_session(&conn)?;
    crate::commands::ytmusic::clear_persisted_stream_cache(&conn);
    crate::commands::ytmusic::clear_stream_cache();
    crate::commands::ytmusic::clear_metadata_cache();
    Ok(())
}

/// Opens YouTube Music website in default browser so the user can verify their sign-in state
#[tauri::command]
pub fn yt_auth_open_browser_url(url: Option<String>) -> Result<(), String> {
    let target = url.unwrap_or_else(|| "https://music.youtube.com".to_string());
    open::that(&target).map_err(|e| e.to_string())
}

/// Opens an in-app WebView window for the user to enter their Google email and password directly
#[tauri::command]
pub async fn yt_auth_open_login_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("yt_login") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        start_yt_login_watcher(app);
        return Ok(());
    }

    // AccountChooser forces Google's account picker instead of silently reusing the
    // WebView's existing session, so signing in always connects the chosen account.
    let url: tauri::Url =
        "https://accounts.google.com/AccountChooser?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F"
            .parse()
            .map_err(|e| format!("URL parse error: {}", e))?;

    tauri::WebviewWindowBuilder::new(&app, "yt_login", tauri::WebviewUrl::External(url))
        .title("Sign in with Google - YouTube Music")
        .inner_size(520.0, 700.0)
        .center()
        .resizable(true)
        .always_on_top(true)
        .build()
        .map_err(|e| format!("Failed to open login window: {}", e))?;

    start_yt_login_watcher(app);

    Ok(())
}

/// Saves manually entered account details or cookies
#[tauri::command]
pub fn yt_auth_save_custom_account(
    name: String,
    email: Option<String>,
    cookie: Option<String>,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<YTAccountInfo, String> {
    let clean_name = if name.trim().is_empty() {
        "YouTube Music Account".to_string()
    } else {
        name.trim().to_string()
    };

    let clean_email = email.map(|s| s.trim().to_string()).unwrap_or_default();

    let account_info = YTAccountInfo {
        is_authenticated: true,
        name: clean_name,
        email: clean_email,
        avatar_url: None,
        channel_title: Some("Connected Account".to_string()),
        channel_id: None,
        access_token: None,
        refresh_token: None,
        cookies: cookie.filter(|c| !c.trim().is_empty()),
        auth_type: "in_app_login".to_string(),
        updated_at: get_now_secs(),
    };

    {
        let conn = db.lock().unwrap();
        save_account_session(&conn, &account_info)?;
        crate::commands::ytmusic::clear_persisted_stream_cache(&conn);
    }
    crate::commands::ytmusic::clear_stream_cache();
    Ok(public_account(account_info))
}
