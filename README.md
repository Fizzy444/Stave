# Stave

Stave is a high-performance, visually stunning local music player built with Tauri, React, and Rust. Designed from the ground up for speed, capability, and aesthetics, it supports managing massive local libraries, fetching lyrics, and even downloading your Spotify playlists.

## 🚀 Features

- **Blazing Fast Library Scanning**: Built on Rust's `lofty`, `rusqlite`, and `rayon`, Stave recursively scans folders in parallel, extracts deep metadata (bitrate, duration, track numbering, embedded art), and syncs it to a local SQLite database running in WAL mode for maximum performance.
- **FTS5 Instant Search**: Search through your entire music library instantaneously thanks to SQLite's Full-Text Search (FTS5) index.
- **Spotify Integration & Downloading**: Paste any public Spotify playlist or album link. Stave scrapes the tracks, finds the highest-quality audio matches on YouTube, and orchestrates `yt-dlp` and `FFmpeg` in Rust to download and tag them locally.
- **Auto-Fix Missing Metadata**: Stave can automatically query the iTunes API to identify untagged local files and write missing metadata (Artists, Albums, and high-res Album Art) directly into the file headers.
- **Time-Synced Lyrics**: Automatically fetches and caches time-synced lyrics (LRC) via the `lrclib.net` API. Features a dedicated scrolling lyrics view that mimics the Apple Music "flowing" blur effect.
- **Advanced Audio Engine**: Features a built-in 10-band Equalizer utilizing the Web Audio API (`BiquadFilterNode`) and a dynamic compressor to prevent clipping. Includes standard presets (Rock, Pop, Acoustic, etc.).
- **Immersive Fullscreen Player**: A distraction-free, cinematic fullscreen mode featuring dynamically blurred album art backgrounds and synced lyrics.
- **Dynamic Theming**: The UI can automatically extract the dominant color from the currently playing album art to dynamically tint the application accent color.
- **Virtualized UI**: The frontend utilizes `@tanstack/react-virtual` to ensure ultra-smooth 60fps scrolling across massive track lists.
- **Inline Tag Editing**: Modify the ID3/Vorbis tags (Title, Artist, Album) of your audio files directly from the UI.

## 🛠️ Tech Stack

**Frontend:**
- React (Vite)
- Zustand (State management with shallow equality and persistence)
- `@tanstack/react-virtual` (Virtualization)
- Phosphor Icons

**Backend:**
- Rust / Tauri V2
- `rusqlite` (SQLite database with WAL mode)
- `lofty` (Audio metadata and tag parsing)
- `rayon` (Parallel processing)
- `reqwest` & `scraper` (Spotify parsing and Lyrics fetching)
- `yt-dlp` & `FFmpeg` (External binaries for audio acquisition)

## 🏃 Getting Started

### Prerequisites
- Node.js (v18+)
- Rust (`rustup default stable`)
- Cargo

### Installation
1. Clone the repository
2. Install Node dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run tauri dev
   ```

### Building for Production
To build a standalone executable for your platform:
```bash
npm run tauri build
```

## 🎨 Design System
The UI adheres to a minimalist, dark-mode-first Oklch color system, featuring glassmorphism elements, high-density rows, custom scrollbars, and fluid animations across all views.
