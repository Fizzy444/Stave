
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpListener;
use rand::{distributions::Alphanumeric, Rng};
use sha2::{Digest, Sha256};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SpotifyTrack {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u32,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SpotifyPlaylist {
    pub name: String,
    pub tracks: Vec<SpotifyTrack>,
}

#[derive(Deserialize, Debug)]
struct SpotifyAnonymousTokenResponse {
    #[serde(rename = "accessToken")]
    access_token: String,
}

#[derive(Deserialize, Debug)]
struct SpotifyPlaylistResponse {
    name: String,
    tracks: SpotifyPlaylistTracks,
}

#[derive(Deserialize, Debug)]
struct SpotifyPlaylistTracks {
    items: Vec<SpotifyPlaylistItem>,
    next: Option<String>,
}

#[derive(Deserialize, Debug)]
struct SpotifyPlaylistItem {
    track: Option<SpotifyTrackNode>,
}

#[derive(Deserialize, Debug)]
struct SpotifyTrackNode {
    name: String,
    artists: Vec<SpotifyArtistNode>,
    album: SpotifyAlbumNode,
    duration_ms: u32,
}

#[derive(Deserialize, Debug)]
struct SpotifyArtistNode {
    name: String,
}

#[derive(Deserialize, Debug)]
struct SpotifyAlbumNode {
    name: String,
}

#[derive(Serialize, Deserialize)]
pub struct SpotifyAuthResult {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[tauri::command]
pub async fn fetch_spotify_playlist(
    playlist_id: String,
) -> Result<SpotifyPlaylist, String> {
    let client = Client::new();

    // Anonymous Token Fallback
    let token_res = client
        .get("https://open.spotify.com/get_access_token?reason=transport&productType=web_player")
        .send()
        .await
        .map_err(|e| format!("Failed to get anonymous token: {}", e))?;

    if !token_res.status().is_success() {
        return Err(format!("Spotify Auth Error: {}", token_res.status()));
    }

    let token_data = token_res
        .json::<SpotifyAnonymousTokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse token: {}", e))?;

    let access_token = token_data.access_token;
    
    // Fetch Playlist
    let initial_url = format!("https://api.spotify.com/v1/playlists/{}", playlist_id);
    let playlist_res = client
        .get(&initial_url)
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch playlist: {}", e))?;

    if !playlist_res.status().is_success() {
        return Err(format!("Spotify API Error: {}", playlist_res.status()));
    }

    let playlist_data = playlist_res
        .json::<SpotifyPlaylistResponse>()
        .await
        .map_err(|e| format!("Failed to parse playlist: {}", e))?;

    let name = playlist_data.name;
    let mut tracks = Vec::new();
    
    let mut next_url = playlist_data.tracks.next;
    
    let mut items = playlist_data.tracks.items;
    
    loop {
        for item in items {
            if let Some(track_node) = item.track {
                let artist_name = track_node
                    .artists
                    .into_iter()
                    .map(|a| a.name)
                    .collect::<Vec<String>>()
                    .join(", ");
                tracks.push(SpotifyTrack {
                    title: track_node.name,
                    artist: if artist_name.is_empty() { "Unknown Artist".into() } else { artist_name },
                    album: track_node.album.name,
                    duration_ms: track_node.duration_ms,
                });
            }
        }
        
        if tracks.len() >= 500 {
            break;
        }

        if let Some(url) = next_url {
            let res = client
                .get(&url)
                .bearer_auth(&access_token)
                .send()
                .await
                .map_err(|e| format!("Pagination error: {}", e))?;
                
            if !res.status().is_success() {
                break;
            }
            
            let page_data = res
                .json::<SpotifyPlaylistTracks>()
                .await
                .map_err(|e| format!("Page parse error: {}", e))?;
                
            items = page_data.items;
            next_url = page_data.next;
        } else {
            break;
        }
    }

    Ok(SpotifyPlaylist {
        name,
        tracks,
    })
}

#[tauri::command]
pub async fn spotify_connect(client_id: String) -> Result<SpotifyAuthResult, String> {
    let code_verifier: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();

    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let code_challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

    let redirect_uri = "http://127.0.0.1:18925/callback";
    let auth_url = format!(
        "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&code_challenge_method=S256&code_challenge={}&scope=playlist-read-private%20playlist-read-collaborative%20user-library-read",
        client_id, redirect_uri, code_challenge
    );

    let _ = open::that(&auth_url);

    let listener = TcpListener::bind("127.0.0.1:18925").map_err(|e| e.to_string())?;
    
    let mut auth_code = String::new();
    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                let mut buffer = [0; 2048];
                let bytes_read = stream.read(&mut buffer).unwrap_or(0);
                if bytes_read == 0 { continue; }
                
                let request = String::from_utf8_lossy(&buffer[..bytes_read]);
                
                // Parse GET /callback?code=XXXX
                if let Some(line) = request.lines().next() {
                    if line.starts_with("GET /callback?code=") {
                        let parts: Vec<&str> = line.split(" ").collect();
                        if parts.len() > 1 {
                            let url_part = parts[1];
                            if let Some(start) = url_part.find("code=") {
                                let rest = &url_part[start + 5..];
                                let end = rest.find("&").unwrap_or(rest.len());
                                auth_code = rest[..end].to_string();
                            }
                        }
                    }
                }
                
                let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><h2>Success!</h2><p>You can close this window and return to the app.</p><script>window.close();</script></body></html>";
                let _ = stream.write(response.as_bytes());
                let _ = stream.flush();
                break;
            }
            Err(e) => return Err(e.to_string()),
        }
    }

    if auth_code.is_empty() {
        return Err("No auth code received".into());
    }

    let client = Client::new();
    let res = client
        .post("https://accounts.spotify.com/api/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "client_id={}&grant_type=authorization_code&code={}&redirect_uri={}&code_verifier={}",
            client_id, auth_code, redirect_uri, code_verifier
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Token exchange failed: {}", res.status()));
    }

    let token_data = res.json::<TokenResponse>().await.map_err(|e| e.to_string())?;

    Ok(SpotifyAuthResult {
        access_token: token_data.access_token,
        refresh_token: token_data.refresh_token,
    })
}

