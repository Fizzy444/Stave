pub mod artwork;
pub mod commands;
pub mod db;
pub mod lyrics;
pub mod metadata;
pub mod scanner;
pub mod tools;

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::sync::Mutex;
use tauri::http::header::{
    ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
};
use tauri::{
    http::{Request, Response, StatusCode},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

fn asset_mime_for_path(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "webp" => "image/webp",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
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

fn parse_asset_range(header: &str, file_size: u64) -> Result<(u64, u64), ()> {
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

fn handle_asset_request(
    request: &Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let url = request.uri().to_string();
    let path_str = url
        .strip_prefix("asset://localhost/")
        .or_else(|| url.strip_prefix("http://asset.localhost/"))
        .unwrap_or(&url);
    let decoded_path = urlencoding::decode(path_str)?.to_string();

    #[cfg(windows)]
    let path_str = decoded_path.trim_start_matches('/').replace("/", "\\");
    #[cfg(not(windows))]
    let path_str = decoded_path;

    let path = Path::new(&path_str);

    if !path.exists() || !path.is_file() {
        return Ok(Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(vec![])?);
    }

    let mut file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_size = metadata.len();
    let is_head = request.method().as_str() == "HEAD";

    let mut response = Response::builder()
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(ACCEPT_RANGES, "bytes")
        .header(CONTENT_TYPE, asset_mime_for_path(path))
        // Artwork filenames are content hashes, so the browser can safely reuse them.
        .header("Cache-Control", "public, max-age=86400");

    if let Some(range_header) = request.headers().get(RANGE) {
        let range_str = range_header.to_str()?;
        let (start, end) = match parse_asset_range(range_str, file_size) {
            Ok(range) => range,
            Err(()) => {
                return Ok(Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(ACCEPT_RANGES, "bytes")
                    .header(CONTENT_RANGE, format!("bytes */{}", file_size))
                    .body(vec![])?);
            }
        };

        let chunk_size = end - start + 1;
        let mut buffer = vec![0; chunk_size as usize];
        file.seek(SeekFrom::Start(start))?;
        file.read_exact(&mut buffer)?;

        response = response
            .status(StatusCode::PARTIAL_CONTENT)
            .header(
                CONTENT_RANGE,
                format!("bytes {}-{}/{}", start, end, file_size),
            )
            .header(CONTENT_LENGTH, chunk_size.to_string());

        Ok(response.body(if is_head { vec![] } else { buffer })?)
    } else {
        let mut buffer = Vec::new();
        if !is_head {
            file.read_to_end(&mut buffer)?;
        }

        response = response
            .status(StatusCode::OK)
            .header(CONTENT_LENGTH, file_size.to_string());

        Ok(response.body(buffer)?)
    }
}

pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ));

    // In debug/dev builds, allow multiple instances so tests/refresh work cleanly;
    // in release, enforce single instance.
    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::library::scan_library,
            commands::library::get_tracks,
            commands::library::mark_played,
            commands::library::move_track,
            commands::library::delete_track,
            commands::library::toggle_favorite,
            commands::library::rescan_library,
            commands::search::search_tracks,
            commands::tags::update_track_tags,
            commands::tags::auto_fix_metadata,
            commands::downloads::search_youtube,
            commands::downloads::queue_download,
            commands::downloads::cancel_download,
            commands::downloads::get_downloads,
            commands::downloads::clear_downloads_log,
            commands::spotify::fetch_spotify_playlist,
            commands::spotify::spotify_connect,
            lyrics::fetch_lyrics,
            lyrics::fetch_lyrics_from_provider,
            lyrics::get_lyrics_providers,
            tools::check_tools,
            tools::download_tools,
            commands::playlists::create_playlist,
            commands::playlists::get_playlists,
            commands::playlists::add_to_playlist,
            commands::playlists::get_playlist_tracks,
            commands::playlists::remove_from_playlist,
            commands::ytmusic::yt_search,
            commands::ytmusic::yt_get_explore,
            commands::ytmusic::yt_get_radio,
            commands::ytmusic::yt_get_playlist,
            commands::ytmusic::yt_get_account_playlists,
            commands::ytmusic::yt_get_stream_url,
            commands::ytmusic::media_proxy_base_url,
            commands::yt_auth::yt_auth_start_browser,
            commands::yt_auth::yt_auth_sync_browser_cookies,
            commands::yt_auth::yt_auth_get_account,
            commands::yt_auth::yt_auth_refresh_account_profile,
            commands::yt_auth::yt_auth_logout,
            commands::yt_auth::yt_auth_open_browser_url,
            commands::yt_auth::yt_auth_open_login_window,
            commands::yt_auth::yt_auth_save_custom_account,
        ])
        .register_uri_scheme_protocol("asset", move |_app, request| {
            handle_asset_request(&request).unwrap_or_else(|e| {
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(e.to_string().into_bytes())
                    .unwrap()
            })
        })
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().unwrap();
            let conn = db::init(app_data_dir).expect("Failed to initialize db");
            app.manage(std::sync::Arc::new(Mutex::new(conn)));
            app.manage(std::sync::Arc::new(Mutex::new(HashMap::<
                String,
                tauri::async_runtime::JoinHandle<()>,
            >::new())));

            // Start the local streaming proxy before the frontend can request a stream.
            // yt-dlp is optional at startup; download it in the background for fallback
            // stream resolution without delaying window creation.
            let app_handle = app.handle().clone();
            let proxy_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                commands::ytmusic::start_stream_proxy(proxy_handle).await;
            });
            tauri::async_runtime::spawn(async move {
                tools::ensure_yt_dlp(&app_handle).await;
            });

            use tauri::menu::{Menu, MenuItem};
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        show_main(tray.app_handle());
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Keep the main app in the tray, but let auxiliary windows (including
                // the YouTube sign-in WebView) close normally so their media is stopped.
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == "yt_login" {
                    // Capture the embedded YouTube session before destroying its WebView.
                    // The cookie API must run asynchronously on Windows to avoid a WebView2 deadlock.
                    api.prevent_close();
                    let app_handle = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(login_window) = app_handle.get_webview_window("yt_login") {
                            commands::yt_auth::finalize_yt_login_session(
                                &app_handle,
                                &login_window,
                            )
                            .await;
                        }
                    });
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| match event {
            tauri::RunEvent::Exit => {
                #[cfg(windows)]
                {
                    let _ = std::process::Command::new("taskkill")
                        .args(["/F", "/IM", "yt-dlp.exe"])
                        .creation_flags(0x08000000) // CREATE_NO_WINDOW
                        .output();
                    let _ = std::process::Command::new("taskkill")
                        .args(["/F", "/IM", "ffmpeg.exe"])
                        .creation_flags(0x08000000)
                        .output();
                }
                #[cfg(not(windows))]
                {
                    let _ = std::process::Command::new("pkill")
                        .arg("-9")
                        .arg("yt-dlp")
                        .output();
                    let _ = std::process::Command::new("pkill")
                        .arg("-9")
                        .arg("ffmpeg")
                        .output();
                }
            }
            _ => {}
        });
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
