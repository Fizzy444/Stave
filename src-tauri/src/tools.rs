use reqwest::Client;
use std::fs;
use std::io::{Cursor, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn get_tools_dir(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap();
    path.push("tools");
    let _ = fs::create_dir_all(&path);
    path
}

#[tauri::command]
pub fn check_tools(app: tauri::AppHandle) -> Result<bool, String> {
    let dir = get_tools_dir(&app);
    let yt_dlp = dir.join("yt-dlp.exe");
    let ffmpeg = dir.join("ffmpeg.exe");
    Ok(yt_dlp.exists() && ffmpeg.exists())
}

#[tauri::command]
pub async fn download_tools(app: tauri::AppHandle) -> Result<(), String> {
    let dir = get_tools_dir(&app);
    let client = Client::new();

    // 1. Download yt-dlp.exe
    let yt_url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
    let resp = client.get(yt_url).send().await.map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let mut yt_file = fs::File::create(dir.join("yt-dlp.exe")).map_err(|e| e.to_string())?;
    yt_file.write_all(&bytes).map_err(|e| e.to_string())?;

    // 2. Download ffmpeg zip and extract ffmpeg.exe
    let ffmpeg_url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
    let resp = client
        .get(ffmpeg_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    let reader = Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;

    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();

        if name.ends_with("ffmpeg.exe") {
            let mut out = fs::File::create(dir.join("ffmpeg.exe")).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}
