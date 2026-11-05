use reqwest::header::USER_AGENT;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LrcLibResponse {
    pub synced_lyrics: Option<String>,
    pub plain_lyrics: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LyricsResult {
    pub synced: Option<String>,
    pub plain: Option<String>,
    pub source: String,
}

pub const SUPPORTED_PROVIDERS: [&str; 11] = [
    "lrc.red",
    "BiniLyrics",
    "BetterLyrics",
    "BetterLyrics Portato",
    "PaxSenix",
    "PaxSenix: Spotify",
    "PaxSenix: Musixmatch",
    "LyricsPlus",
    "Unison",
    "YouTube captions",
    "YouTube Music",
];

#[tauri::command]
pub fn get_lyrics_providers() -> Vec<String> {
    SUPPORTED_PROVIDERS.iter().map(|s| s.to_string()).collect()
}

fn ms_to_lrc_timestamp(ms: u64) -> String {
    let total_secs = ms / 1000;
    let mins = total_secs / 60;
    let secs = total_secs % 60;
    let hundredths = (ms % 1000) / 10;
    format!("[{:02}:{:02}.{:02}]", mins, secs, hundredths)
}

fn strip_lrc_timestamps(lrc: &str) -> String {
    let mut plain_lines = Vec::new();
    for line in lrc.lines() {
        let trimmed = line.trim();
        let content = if trimmed.starts_with('[') {
            if let Some(closing_idx) = trimmed.find(']') {
                trimmed[closing_idx + 1..].trim()
            } else {
                trimmed
            }
        } else {
            trimmed
        };

        // Strip <...> enhanced word tags and (...) QRC tags
        let mut clean = String::new();
        let mut in_angle = false;
        let mut in_paren = false;
        for ch in content.chars() {
            if ch == '<' {
                in_angle = true;
            } else if ch == '>' {
                in_angle = false;
            } else if ch == '(' {
                in_paren = true;
            } else if ch == ')' {
                in_paren = false;
            } else if !in_angle && !in_paren {
                clean.push(ch);
            }
        }

        let clean_trimmed = clean.trim();
        // Ignore lines that were just tags or metadata
        if !clean_trimmed.is_empty() && !clean_trimmed.starts_with('[') {
            plain_lines.push(clean_trimmed.to_string());
        }
    }

    // If word-by-word (many single-word lines), join words into readable sentences
    let non_empty_count = plain_lines.len();
    if non_empty_count >= 8 {
        let single_word_count = plain_lines.iter().filter(|l| !l.contains(' ')).count();
        if (single_word_count as f64) / (non_empty_count as f64) >= 0.65 {
            let mut assembled = Vec::new();
            let mut current_words = Vec::new();
            for word in plain_lines {
                let ends_punct = word.ends_with('.')
                    || word.ends_with('?')
                    || word.ends_with('!')
                    || word.ends_with(',');
                current_words.push(word);
                if current_words.len() >= 7 || (current_words.len() >= 4 && ends_punct) {
                    assembled.push(current_words.join(" "));
                    current_words.clear();
                }
            }
            if !current_words.is_empty() {
                assembled.push(current_words.join(" "));
            }
            return assembled.join("\n");
        }
    }

    plain_lines.join("\n")
}

fn clean_title_query(title: &str) -> String {
    let mut cleaned = title.to_string();
    let fluffs = [
        "(Official Video)",
        "[Official Video]",
        "(Official Music Video)",
        "[Official Music Video]",
        "(Lyric Video)",
        "[Lyric Video]",
        "(Lyrics)",
        "[Lyrics]",
        "(Audio)",
        "[Audio]",
        "(Official Audio)",
        "[Official Audio]",
        "(Visualizer)",
        "[Visualizer]",
        "(HD)",
        "[HD]",
        "(4K)",
        "[4K]",
    ];
    for fluff in fluffs {
        cleaned = cleaned.replace(fluff, "");
    }
    cleaned.trim().to_string()
}

fn parse_ttml_time(s: &str) -> Option<u64> {
    let s = s.trim().trim_end_matches('s');
    if let Ok(secs) = s.parse::<f64>() {
        return Some((secs * 1000.0) as u64);
    }
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() == 2 {
        let mins: f64 = parts[0].parse().ok()?;
        let secs: f64 = parts[1].parse().ok()?;
        Some(((mins * 60.0 + secs) * 1000.0) as u64)
    } else if parts.len() == 3 {
        let hrs: f64 = parts[0].parse().ok()?;
        let mins: f64 = parts[1].parse().ok()?;
        let secs: f64 = parts[2].parse().ok()?;
        Some(((hrs * 3600.0 + mins * 60.0 + secs) * 1000.0) as u64)
    } else {
        None
    }
}

fn strip_xml_tags(input: &str) -> String {
    let mut output = String::new();
    let mut inside = false;
    for ch in input.chars() {
        if ch == '<' {
            inside = true;
        } else if ch == '>' {
            inside = false;
        } else if !inside {
            output.push(ch);
        }
    }
    output
        .replace("&amp;", "&")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .trim()
        .to_string()
}

fn parse_ttml_to_lrc(ttml_content: &str) -> (Option<String>, Option<String>) {
    let mut lrc_lines = Vec::new();
    let mut plain_lines = Vec::new();

    let mut remaining = ttml_content;
    while let Some(p_start) = remaining.find("<p") {
        let after_p = &remaining[p_start..];
        let p_end = match after_p.find("</p>") {
            Some(idx) => idx + 4,
            None => break,
        };

        let tag_block = &after_p[..p_end];
        remaining = &after_p[p_end..];

        // Extract begin attribute: begin="..." or begin='...'
        let begin_val = tag_block
            .find("begin=\"")
            .and_then(|idx| {
                let sub = &tag_block[idx + 7..];
                sub.find('"').map(|end| &sub[..end])
            })
            .or_else(|| {
                tag_block.find("begin='").and_then(|idx| {
                    let sub = &tag_block[idx + 7..];
                    sub.find('\'').map(|end| &sub[..end])
                })
            });

        let content_start = match tag_block.find('>') {
            Some(idx) => idx + 1,
            None => continue,
        };
        let content_end = tag_block.rfind("</p>").unwrap_or(tag_block.len());
        let raw_text = &tag_block[content_start..content_end];
        let clean = strip_xml_tags(raw_text);

        if clean.is_empty() {
            continue;
        }

        if let Some(begin_str) = begin_val {
            if let Some(ms) = parse_ttml_time(begin_str) {
                let ts = ms_to_lrc_timestamp(ms);
                lrc_lines.push(format!("{} {}", ts, clean));
            }
        }
        plain_lines.push(clean);
    }

    let synced = if !lrc_lines.is_empty() {
        Some(lrc_lines.join("\n"))
    } else {
        None
    };

    let plain = if !plain_lines.is_empty() {
        Some(plain_lines.join("\n"))
    } else {
        None
    };

    (synced, plain)
}

fn parse_qrc_to_lrc(qrc_content: &str) -> (Option<String>, Option<String>) {
    let mut lrc_lines = Vec::new();
    let mut plain_lines = Vec::new();

    for line in qrc_content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if let Some(closing) = trimmed.find(']') {
                let ts_part = &trimmed[1..closing];
                let ts_clean = ts_part.split(',').next().unwrap_or(ts_part).trim();

                let rest = &trimmed[closing + 1..];
                // Strip (offset, dur) tokens from QRC word-level markup
                let mut clean_words = String::new();
                let mut in_paren = false;
                for ch in rest.chars() {
                    if ch == '(' {
                        in_paren = true;
                    } else if ch == ')' {
                        in_paren = false;
                    } else if !in_paren {
                        clean_words.push(ch);
                    }
                }
                let clean_text = clean_words.trim().to_string();
                if !clean_text.is_empty() {
                    lrc_lines.push(format!("[{}] {}", ts_clean, clean_text));
                    plain_lines.push(clean_text);
                }
            }
        }
    }

    if !lrc_lines.is_empty() {
        (Some(lrc_lines.join("\n")), Some(plain_lines.join("\n")))
    } else {
        (None, None)
    }
}

fn parse_json_lines_to_lrc(lines_arr: &[serde_json::Value]) -> (Option<String>, Option<String>) {
    let mut lrc_lines = Vec::new();
    let mut plain_lines = Vec::new();

    for item in lines_arr {
        let text = item
            .get("words")
            .or_else(|| item.get("text"))
            .or_else(|| item.get("line"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();

        if text.is_empty() {
            continue;
        }

        let time_ms = item
            .get("startTimeMs")
            .and_then(|v| {
                if let Some(s) = v.as_str() {
                    s.parse::<u64>().ok()
                } else {
                    v.as_u64()
                }
            })
            .or_else(|| item.get("time").and_then(|v| v.as_u64()))
            .or_else(|| {
                item.get("start").and_then(|v| {
                    if let Some(f) = v.as_f64() {
                        Some((f * 1000.0) as u64)
                    } else {
                        v.as_u64()
                    }
                })
            });

        if let Some(ms) = time_ms {
            let ts = ms_to_lrc_timestamp(ms);
            lrc_lines.push(format!("{} {}", ts, text));
        }
        plain_lines.push(text.to_string());
    }

    if !lrc_lines.is_empty() {
        (Some(lrc_lines.join("\n")), Some(plain_lines.join("\n")))
    } else if !plain_lines.is_empty() {
        (None, Some(plain_lines.join("\n")))
    } else {
        (None, None)
    }
}

fn extract_lyrics_from_json(val: &serde_json::Value, source_name: &str) -> Option<LyricsResult> {
    // 1. Direct lyrics string
    if let Some(lyrics_str) = val.get("lyrics").and_then(|l| l.as_str()) {
        if lyrics_str.contains("<tt")
            || lyrics_str.contains("<p begin=")
            || lyrics_str.starts_with("<?xml")
        {
            let (synced, plain) = parse_ttml_to_lrc(lyrics_str);
            if synced.is_some() || plain.is_some() {
                return Some(LyricsResult {
                    synced,
                    plain,
                    source: source_name.to_string(),
                });
            }
        }
        if lyrics_str.contains('[') && lyrics_str.contains(']') {
            let plain = strip_lrc_timestamps(lyrics_str);
            return Some(LyricsResult {
                synced: Some(lyrics_str.to_string()),
                plain: Some(plain),
                source: source_name.to_string(),
            });
        }
        return Some(LyricsResult {
            synced: None,
            plain: Some(lyrics_str.to_string()),
            source: source_name.to_string(),
        });
    }

    // 2. TTML / RichSync in field
    if let Some(ttml_str) = val
        .get("ttml")
        .or_else(|| val.get("richsync"))
        .and_then(|t| t.as_str())
    {
        let (synced, plain) = parse_ttml_to_lrc(ttml_str);
        if synced.is_some() || plain.is_some() {
            return Some(LyricsResult {
                synced,
                plain,
                source: source_name.to_string(),
            });
        }
    }

    // 3. Spotify / PaxSenix lines array: val.lyrics.lines or val.lines
    let lines_arr = val
        .pointer("/lyrics/lines")
        .or_else(|| val.get("lines"))
        .and_then(|l| l.as_array());

    if let Some(lines) = lines_arr {
        let (synced, plain) = parse_json_lines_to_lrc(lines);
        if synced.is_some() || plain.is_some() {
            return Some(LyricsResult {
                synced,
                plain,
                source: source_name.to_string(),
            });
        }
    }

    // 4. Synced / Plain lyrics explicit properties
    let synced = val
        .get("syncedLyrics")
        .or_else(|| val.get("synced"))
        .or_else(|| val.get("lrc"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let plain = val
        .get("plainLyrics")
        .or_else(|| val.get("plain"))
        .or_else(|| val.get("text"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| synced.as_deref().map(strip_lrc_timestamps));

    if synced.is_some() || plain.is_some() {
        return Some(LyricsResult {
            synced,
            plain,
            source: source_name.to_string(),
        });
    }

    None
}

// ---------------------------------------------------------
// Provider fetchers
// ---------------------------------------------------------

async fn fetch_lrc_red(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    album: &str,
    duration_s: u64,
) -> Option<LyricsResult> {
    let clean_t = clean_title_query(title);
    let query = format!("{} {}", artist, clean_t);

    // 1. Try lrc.red search API
    let search_url = format!(
        "https://lrc.red/search.json?q={}",
        urlencoding::encode(&query)
    );
    if let Ok(resp) = client
        .get(&search_url)
        .header(USER_AGENT, "Stave-Music-Player/1.0")
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(hits) = data.get("hits").and_then(|h| h.as_array()) {
                    if let Some(first_hit) = hits.first() {
                        if let Some(isrc) = first_hit.get("isrc").and_then(|i| i.as_str()) {
                            let lrc_url = format!("https://lrc.red/s/{}.lrc", isrc);
                            if let Ok(lrc_resp) = client
                                .get(&lrc_url)
                                .header(USER_AGENT, "Stave-Music-Player/1.0")
                                .send()
                                .await
                            {
                                if lrc_resp.status().is_success() {
                                    if let Ok(text) = lrc_resp.text().await {
                                        if text.contains('[') && text.contains(']') {
                                            let plain = strip_lrc_timestamps(&text);
                                            return Some(LyricsResult {
                                                synced: Some(text),
                                                plain: Some(plain),
                                                source: "lrc.red".into(),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback to LRCLIB
    let lrclib_url = format!(
        "https://lrclib.net/api/get?track_name={}&artist_name={}&album_name={}&duration={}",
        urlencoding::encode(&clean_t),
        urlencoding::encode(artist),
        urlencoding::encode(album),
        duration_s
    );
    if let Ok(res) = client
        .get(&lrclib_url)
        .header(USER_AGENT, "Stave-Music-Player/1.0")
        .send()
        .await
    {
        if res.status().is_success() {
            if let Ok(data) = res.json::<LrcLibResponse>().await {
                if data.synced_lyrics.is_some() || data.plain_lyrics.is_some() {
                    return Some(LyricsResult {
                        synced: data.synced_lyrics,
                        plain: data.plain_lyrics,
                        source: "lrc.red".into(),
                    });
                }
            }
        }
    }

    // 3. Search LRCLIB
    let search_lrclib = format!(
        "https://lrclib.net/api/search?q={}",
        urlencoding::encode(&query)
    );
    if let Ok(res) = client
        .get(&search_lrclib)
        .header(USER_AGENT, "Stave-Music-Player/1.0")
        .send()
        .await
    {
        if res.status().is_success() {
            if let Ok(items) = res.json::<Vec<LrcLibResponse>>().await {
                for item in items {
                    if item.synced_lyrics.is_some() || item.plain_lyrics.is_some() {
                        return Some(LyricsResult {
                            synced: item.synced_lyrics,
                            plain: item.plain_lyrics,
                            source: "lrc.red".into(),
                        });
                    }
                }
            }
        }
    }

    None
}

async fn fetch_binilyrics(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
) -> Option<LyricsResult> {
    let clean_t = clean_title_query(title);
    let endpoints = [
        format!(
            "https://lyrics-api.binimum.org/getLyrics?a={}&s={}",
            urlencoding::encode(artist),
            urlencoding::encode(&clean_t)
        ),
        format!(
            "https://lyrics-api.binimum.org/get?a={}&s={}",
            urlencoding::encode(artist),
            urlencoding::encode(&clean_t)
        ),
    ];

    for url in &endpoints {
        if let Ok(resp) = client
            .get(url)
            .header(USER_AGENT, "Stave-Music-Player/1.0")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(res) = extract_lyrics_from_json(&val, "BiniLyrics") {
                        return Some(res);
                    }
                }
            }
        }
    }
    None
}

async fn fetch_betterlyrics(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
) -> Option<LyricsResult> {
    let clean_t = clean_title_query(title);
    let endpoints = [
        format!(
            "https://lyrics-api.boidu.dev/getLyrics?a={}&s={}",
            urlencoding::encode(artist),
            urlencoding::encode(&clean_t)
        ),
        format!(
            "https://lyrics-api.boidu.dev/getLyrics?artist={}&song={}",
            urlencoding::encode(artist),
            urlencoding::encode(&clean_t)
        ),
        format!(
            "https://lyrics-api.boidu.dev/get?a={}&s={}",
            urlencoding::encode(artist),
            urlencoding::encode(&clean_t)
        ),
    ];

    for url in &endpoints {
        if let Ok(resp) = client
            .get(url)
            .header(USER_AGENT, "BetterLyrics/1.0")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(res) = extract_lyrics_from_json(&val, "BetterLyrics") {
                        return Some(res);
                    }
                }
            }
        }
    }
    None
}

async fn fetch_betterlyrics_portato(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
) -> Option<LyricsResult> {
    let clean_t = clean_title_query(title);
    let endpoints = [
        format!(
            "https://lyrics-api.boidu.dev/qq/getLyrics?a={}&s={}",
            urlencoding::encode(artist),
            urlencoding::encode(&clean_t)
        ),
        format!(
            "https://lyrics-api.boidu.dev/qq/getLyrics?artist={}&song={}",
            urlencoding::encode(artist),
            urlencoding::encode(&clean_t)
        ),
        format!(
            "https://portato.betterlyrics.org/getLyrics?a={}&s={}",
            urlencoding::encode(artist),
            urlencoding::encode(&clean_t)
        ),
    ];

    for url in &endpoints {
        if let Ok(resp) = client
            .get(url)
            .header(USER_AGENT, "BetterLyrics/1.0")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    // Check if lyrics field contains QRC
                    if let Some(lyr) = val.get("lyrics").and_then(|l| l.as_str()) {
                        let (qrc_synced, qrc_plain) = parse_qrc_to_lrc(lyr);
                        if qrc_synced.is_some() {
                            return Some(LyricsResult {
                                synced: qrc_synced,
                                plain: qrc_plain,
                                source: "BetterLyrics Portato".into(),
                            });
                        }
                    }
                    if let Some(res) = extract_lyrics_from_json(&val, "BetterLyrics Portato") {
                        return Some(res);
                    }
                }
            }
        }
    }
    None
}

async fn fetch_paxsenix(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
) -> Option<LyricsResult> {
    let clean_t = clean_title_query(title);
    let query = format!("{} {}", artist, clean_t);
    let endpoints = [
        format!(
            "https://lyrics.paxsenix.org/apple-music/lyrics?q={}",
            urlencoding::encode(&query)
        ),
        format!(
            "https://api.paxsenix.biz.id/apple-music/lyrics?q={}",
            urlencoding::encode(&query)
        ),
        format!(
            "https://lyrics.paxsenix.org/lyrics?title={}&artist={}",
            urlencoding::encode(&clean_t),
            urlencoding::encode(artist)
        ),
    ];

    for url in &endpoints {
        if let Ok(resp) = client
            .get(url)
            .header(USER_AGENT, "Stave-Music-Player/1.0")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(res) = extract_lyrics_from_json(&val, "PaxSenix") {
                        return Some(res);
                    }
                }
            }
        }
    }
    None
}

async fn fetch_paxsenix_spotify(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
) -> Option<LyricsResult> {
    let clean_t = clean_title_query(title);
    let query = format!("{} {}", artist, clean_t);
    let endpoints = [
        format!(
            "https://lyrics.paxsenix.org/spotify/lyrics?q={}",
            urlencoding::encode(&query)
        ),
        format!(
            "https://api.paxsenix.biz.id/spotify/lyrics?q={}",
            urlencoding::encode(&query)
        ),
        format!(
            "https://lyrics.paxsenix.org/spotify/lyrics?title={}&artist={}",
            urlencoding::encode(&clean_t),
            urlencoding::encode(artist)
        ),
    ];

    for url in &endpoints {
        if let Ok(resp) = client
            .get(url)
            .header(USER_AGENT, "Stave-Music-Player/1.0")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(res) = extract_lyrics_from_json(&val, "PaxSenix: Spotify") {
                        return Some(res);
                    }
                }
            }
        }
    }
    None
}

async fn fetch_paxsenix_musixmatch(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
) -> Option<LyricsResult> {
    let clean_t = clean_title_query(title);
    let query = format!("{} {}", artist, clean_t);
    let endpoints = [
        format!(
            "https://lyrics.paxsenix.org/musixmatch/lyrics?q={}",
            urlencoding::encode(&query)
        ),
        format!(
            "https://api.paxsenix.biz.id/musixmatch/lyrics?q={}",
            urlencoding::encode(&query)
        ),
        format!(
            "https://lyrics.paxsenix.org/musixmatch/lyrics?title={}&artist={}",
            urlencoding::encode(&clean_t),
            urlencoding::encode(artist)
        ),
    ];

    for url in &endpoints {
        if let Ok(resp) = client
            .get(url)
            .header(USER_AGENT, "Stave-Music-Player/1.0")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(res) = extract_lyrics_from_json(&val, "PaxSenix: Musixmatch") {
                        return Some(res);
                    }
                }
            }
        }
    }
    None
}

async fn fetch_lyrics_plus(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    duration_s: u64,
) -> Option<LyricsResult> {
    let clean_t = clean_title_query(title);
    let endpoints = [
        format!(
            "https://lyrics-plus.youly.org/v1/lyrics/get?title={}&artist={}&duration={}",
            urlencoding::encode(&clean_t),
            urlencoding::encode(artist),
            duration_s
        ),
        format!(
            "https://lyrics-plus.binimum.org/v1/lyrics/get?title={}&artist={}&duration={}",
            urlencoding::encode(&clean_t),
            urlencoding::encode(artist),
            duration_s
        ),
        format!(
            "https://lyrics-plus.youly.org/v1/lyrics/get?title={}&artist={}",
            urlencoding::encode(&clean_t),
            urlencoding::encode(artist)
        ),
    ];

    for url in &endpoints {
        if let Ok(resp) = client
            .get(url)
            .header(USER_AGENT, "Stave-Music-Player/1.0")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(res) = extract_lyrics_from_json(&val, "LyricsPlus") {
                        return Some(res);
                    }
                }
            }
        }
    }
    None
}

async fn fetch_unison(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    video_id: Option<&str>,
) -> Option<LyricsResult> {
    let clean_t = clean_title_query(title);
    let mut endpoints = Vec::new();
    if let Some(vid) = video_id {
        if !vid.is_empty() {
            endpoints.push(format!("https://unison.boidu.dev/lyrics?v={}", vid));
        }
    }
    endpoints.push(format!(
        "https://unison.boidu.dev/lyrics?song={}&artist={}",
        urlencoding::encode(&clean_t),
        urlencoding::encode(artist)
    ));
    endpoints.push(format!(
        "https://unison.boidu.dev/api/lyrics?title={}&artist={}",
        urlencoding::encode(&clean_t),
        urlencoding::encode(artist)
    ));

    for url in &endpoints {
        if let Ok(resp) = client
            .get(url)
            .header(USER_AGENT, "BetterLyrics/1.0")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(res) = extract_lyrics_from_json(&val, "Unison") {
                        return Some(res);
                    }
                }
            }
        }
    }
    None
}

async fn resolve_youtube_video_id(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
) -> Option<String> {
    let clean_t = clean_title_query(title);
    let query = format!("{} {}", artist, clean_t);

    let body = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "query": query
    });

    let resp = client
        .post("https://music.youtube.com/youtubei/v1/search")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .ok()?;

    let json: serde_json::Value = resp.json().await.ok()?;

    // Search for first videoId in response
    find_first_video_id(&json)
}

fn find_first_video_id(val: &serde_json::Value) -> Option<String> {
    match val {
        serde_json::Value::Object(map) => {
            if let Some(watch) = map.get("watchEndpoint") {
                if let Some(id) = watch.get("videoId").and_then(|v| v.as_str()) {
                    if !id.is_empty() {
                        return Some(id.to_string());
                    }
                }
            }
            if let Some(id) = map.get("videoId").and_then(|v| v.as_str()) {
                if !id.is_empty() {
                    return Some(id.to_string());
                }
            }
            for (_k, v) in map {
                if let Some(id) = find_first_video_id(v) {
                    return Some(id);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(id) = find_first_video_id(v) {
                    return Some(id);
                }
            }
        }
        _ => {}
    }
    None
}

async fn fetch_youtube_captions(client: &reqwest::Client, video_id: &str) -> Option<LyricsResult> {
    let body = serde_json::json!({
        "context": {
            "client": {
                "clientName": "ANDROID",
                "clientVersion": "19.09.37",
                "hl": "en",
                "gl": "US"
            }
        },
        "videoId": video_id
    });

    let resp = client
        .post("https://www.youtube.com/youtubei/v1/player")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .ok()?;

    let json: serde_json::Value = resp.json().await.ok()?;
    let caption_tracks = json
        .pointer("/captions/playerCaptionsTracklistRenderer/captionTracks")
        .and_then(|c| c.as_array())?;

    if caption_tracks.is_empty() {
        return None;
    }

    let best_track = caption_tracks
        .iter()
        .find(|t| {
            let lang = t.get("languageCode").and_then(|l| l.as_str()).unwrap_or("");
            let kind = t.get("kind").and_then(|k| k.as_str()).unwrap_or("");
            lang == "en" && kind != "asr"
        })
        .or_else(|| {
            caption_tracks.iter().find(|t| {
                let lang = t.get("languageCode").and_then(|l| l.as_str()).unwrap_or("");
                lang.starts_with("en")
            })
        })
        .or_else(|| caption_tracks.first())?;

    let base_url = best_track.get("baseUrl").and_then(|u| u.as_str())?;
    let timed_url = format!("{}&fmt=json3", base_url);

    let timed_resp = client.get(&timed_url).send().await.ok()?;
    let timed_json: serde_json::Value = timed_resp.json().await.ok()?;

    let events = timed_json.get("events").and_then(|e| e.as_array())?;
    let mut lrc_lines = Vec::new();
    let mut plain_lines = Vec::new();

    for ev in events {
        let start_ms = ev.get("tStartMs").and_then(|t| t.as_u64()).unwrap_or(0);
        let mut line_text = String::new();
        if let Some(segs) = ev.get("segs").and_then(|s| s.as_array()) {
            for seg in segs {
                if let Some(utf8) = seg.get("utf8").and_then(|u| u.as_str()) {
                    line_text.push_str(utf8);
                }
            }
        }
        let clean = line_text.trim().replace('\n', " ");
        if !clean.is_empty() {
            let ts = ms_to_lrc_timestamp(start_ms);
            lrc_lines.push(format!("{} {}", ts, clean));
            plain_lines.push(clean);
        }
    }

    if lrc_lines.is_empty() {
        return None;
    }

    Some(LyricsResult {
        synced: Some(lrc_lines.join("\n")),
        plain: Some(plain_lines.join("\n")),
        source: "YouTube captions".into(),
    })
}

fn find_lyrics_browse_id(val: &serde_json::Value) -> Option<String> {
    match val {
        serde_json::Value::Object(map) => {
            if let Some(title) = map.get("title").and_then(|t| t.as_str()) {
                if title == "Lyrics" {
                    if let Some(browse_id) = map
                        .get("endpoint")
                        .and_then(|e| e.pointer("/browseEndpoint/browseId"))
                        .and_then(|b| b.as_str())
                    {
                        return Some(browse_id.to_string());
                    }
                }
            }
            if let Some(runs) = map
                .get("title")
                .and_then(|t| t.get("runs"))
                .and_then(|r| r.as_array())
            {
                let is_lyrics = runs
                    .iter()
                    .any(|r| r.get("text").and_then(|t| t.as_str()) == Some("Lyrics"));
                if is_lyrics {
                    if let Some(browse_id) = map
                        .get("endpoint")
                        .and_then(|e| e.pointer("/browseEndpoint/browseId"))
                        .and_then(|b| b.as_str())
                    {
                        return Some(browse_id.to_string());
                    }
                }
            }
            for (_k, v) in map {
                if let Some(id) = find_lyrics_browse_id(v) {
                    return Some(id);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(id) = find_lyrics_browse_id(v) {
                    return Some(id);
                }
            }
        }
        _ => {}
    }
    None
}

async fn fetch_youtube_music_lyrics(
    client: &reqwest::Client,
    video_id: &str,
) -> Option<LyricsResult> {
    let next_body = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "videoId": video_id
    });

    let next_resp = client
        .post("https://music.youtube.com/youtubei/v1/next")
        .header("Content-Type", "application/json")
        .json(&next_body)
        .send()
        .await
        .ok()?;

    let next_json: serde_json::Value = next_resp.json().await.ok()?;
    let browse_id = find_lyrics_browse_id(&next_json)?;

    let browse_body = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "browseId": browse_id
    });

    let browse_resp = client
        .post("https://music.youtube.com/youtubei/v1/browse")
        .header("Content-Type", "application/json")
        .json(&browse_body)
        .send()
        .await
        .ok()?;

    let browse_json: serde_json::Value = browse_resp.json().await.ok()?;
    let runs = browse_json
        .pointer("/contents/sectionListRenderer/contents/0/musicDescriptionShelfRenderer/description/runs")
        .or_else(|| browse_json.pointer("/contents/sectionListRenderer/contents/0/musicDescriptionShelfRenderer/runs"))
        .and_then(|r| r.as_array())?;

    let text = runs
        .iter()
        .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("");

    let clean = text.trim();
    if clean.is_empty() {
        return None;
    }

    Some(LyricsResult {
        synced: None,
        plain: Some(clean.to_string()),
        source: "YouTube Music".into(),
    })
}

// ---------------------------------------------------------
// Master dispatch
// ---------------------------------------------------------

pub async fn execute_provider_fetch(
    provider: &str,
    title: &str,
    artist: &str,
    album: &str,
    duration_s: u64,
    video_id: Option<&str>,
) -> Option<LyricsResult> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .ok()?;

    match provider {
        "lrc.red" => fetch_lrc_red(&client, title, artist, album, duration_s).await,
        "BiniLyrics" => fetch_binilyrics(&client, title, artist).await,
        "BetterLyrics" => fetch_betterlyrics(&client, title, artist).await,
        "BetterLyrics Portato" => fetch_betterlyrics_portato(&client, title, artist).await,
        "PaxSenix" => fetch_paxsenix(&client, title, artist).await,
        "PaxSenix: Spotify" => fetch_paxsenix_spotify(&client, title, artist).await,
        "PaxSenix: Musixmatch" => fetch_paxsenix_musixmatch(&client, title, artist).await,
        "LyricsPlus" => fetch_lyrics_plus(&client, title, artist, duration_s).await,
        "Unison" => fetch_unison(&client, title, artist, video_id).await,
        "YouTube captions" => {
            let vid = match video_id {
                Some(v) if !v.is_empty() => v.to_string(),
                _ => resolve_youtube_video_id(&client, title, artist)
                    .await
                    .unwrap_or_default(),
            };
            if vid.is_empty() {
                None
            } else {
                fetch_youtube_captions(&client, &vid).await
            }
        }
        "YouTube Music" => {
            let vid = match video_id {
                Some(v) if !v.is_empty() => v.to_string(),
                _ => resolve_youtube_video_id(&client, title, artist)
                    .await
                    .unwrap_or_default(),
            };
            if vid.is_empty() {
                None
            } else {
                fetch_youtube_music_lyrics(&client, &vid).await
            }
        }
        _ => fetch_lrc_red(&client, title, artist, album, duration_s).await,
    }
}

// ---------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------

#[tauri::command]
pub async fn fetch_lyrics_from_provider(
    track_id: serde_json::Value,
    provider: String,
    title: String,
    artist: String,
    album: String,
    duration_ms: u64,
    video_id: Option<String>,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<LyricsResult, String> {
    let mut track_key = match &track_id {
        serde_json::Value::Number(n) if n.as_i64() != Some(0) => n.to_string(),
        serde_json::Value::String(s) if !s.is_empty() && s != "0" => s.clone(),
        _ => String::new(),
    };

    if track_key.is_empty() {
        if let Some(ref vid) = video_id {
            if !vid.is_empty() {
                track_key = format!("yt_{}", vid);
            }
        }
    }

    let can_cache = !track_key.is_empty();

    // Ensure database table for provider cache exists
    if can_cache {
        let conn = db.lock().unwrap();
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS lyrics_cache_v2 (
                track_key TEXT,
                provider TEXT,
                synced TEXT,
                plain TEXT,
                fetched_at INTEGER,
                PRIMARY KEY (track_key, provider)
            );",
        );

        let mut stmt = conn
            .prepare(
                "SELECT synced, plain FROM lyrics_cache_v2 WHERE track_key = ? AND provider = ?",
            )
            .unwrap();
        let mut cached = None;
        if let Ok(mut iter) = stmt.query_map([&track_key, &provider], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        }) {
            if let Some(Ok((s, p))) = iter.next() {
                cached = Some(LyricsResult {
                    synced: s,
                    plain: p,
                    source: provider.clone(),
                });
            }
        }

        if let Some(res) = cached {
            return Ok(res);
        }
    }

    let duration_s = duration_ms / 1000;
    let res = execute_provider_fetch(
        &provider,
        &title,
        &artist,
        &album,
        duration_s,
        video_id.as_deref(),
    )
    .await
    .ok_or_else(|| format!("Lyrics not found from {}", provider))?;

    // Cache the successful result
    if can_cache {
        let conn = db.lock().unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let _ = conn.execute(
            "INSERT OR REPLACE INTO lyrics_cache_v2 (track_key, provider, synced, plain, fetched_at) VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![&track_key, &provider, res.synced, res.plain, now as i64],
        );

        // Also update legacy lyrics_cache if numeric id
        if let Ok(num_id) = track_key.parse::<i64>() {
            let _ = conn.execute(
                "INSERT OR REPLACE INTO lyrics_cache (track_id, synced, plain, source, fetched_at) VALUES (?, ?, ?, ?, ?)",
                rusqlite::params![num_id, res.synced, res.plain, res.source, now as i64],
            );
        }
    }

    Ok(res)
}

#[tauri::command]
pub async fn fetch_lyrics(
    track_id: serde_json::Value,
    title: String,
    artist: String,
    album: String,
    duration_ms: u64,
    provider: Option<String>,
    video_id: Option<String>,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<LyricsResult, String> {
    let chosen_provider = provider.unwrap_or_else(|| "lrc.red".to_string());
    fetch_lyrics_from_provider(
        track_id,
        chosen_provider,
        title,
        artist,
        album,
        duration_ms,
        video_id,
        db,
    )
    .await
}
