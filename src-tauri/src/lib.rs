pub mod artwork;
pub mod commands;
pub mod db;
pub mod lyrics;
pub mod metadata;
pub mod scanner;
pub mod tools;

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

    if !path.exists() {
        return Ok(Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(vec![])?);
    }

    let mut file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_size = metadata.len();

    let mut response = Response::builder()
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(ACCEPT_RANGES, "bytes")
        .header(CONTENT_TYPE, "audio/mpeg");

    if let Some(range_header) = request.headers().get(RANGE) {
        let range_str = range_header.to_str()?;
        let range_val = range_str.replace("bytes=", "");
        let ranges: Vec<&str> = range_val.split('-').collect();

        let start: u64 = if !ranges[0].is_empty() {
            ranges[0].parse()?
        } else {
            0
        };

        let end: u64 = if ranges.len() > 1 && !ranges[1].is_empty() {
            ranges[1].parse()?
        } else {
            file_size - 1
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

        Ok(response.body(buffer)?)
    } else {
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)?;

        response = response
            .status(StatusCode::OK)
            .header(CONTENT_LENGTH, file_size.to_string());

        Ok(response.body(buffer)?)
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::library::scan_library,
            commands::library::get_tracks,
            commands::library::mark_played,
            commands::library::move_track,
            commands::library::delete_track,
            commands::library::toggle_favorite,
            commands::search::search_tracks,
            commands::tags::update_track_tags,
            commands::tags::auto_fix_metadata,
            commands::downloads::search_youtube,
            commands::downloads::queue_download,
            commands::downloads::get_downloads,
            commands::spotify::fetch_spotify_playlist,
            commands::spotify::spotify_connect,
            lyrics::fetch_lyrics,
            tools::check_tools,
            tools::download_tools,
            commands::playlists::create_playlist,
            commands::playlists::get_playlists,
            commands::playlists::add_to_playlist,
            commands::playlists::get_playlist_tracks,
            commands::playlists::remove_from_playlist,
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
                api.prevent_close();
                let _ = window.hide();
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
