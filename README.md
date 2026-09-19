# Stave

Stave is a high-performance, visually stunning local music player built with Tauri, React, and Rust. Designed from the ground up for speed and capability, it supports managing libraries with tens of thousands of tracks without breaking a sweat.

## 🚀 Features

- **Blazing Fast Library Scanning**: Built on Rust's `lofty` and `rusqlite`, Stave quickly scans folders, extracts deep metadata (bitrate, duration, track numbering, embedded art), and syncs it to a local SQLite database.
- **FTS5 Instant Search**: Search through your entire music library instantaneously thanks to SQLite's Full-Text Search (FTS5) index.
- **Virtualized UI**: The frontend utilizes `@tanstack/react-virtual` to ensure ultra-smooth 60fps scrolling across massive track lists.
- **Advanced Audio Engine**: Features a built-in 10-band Equalizer utilizing the Web Audio API (`BiquadFilterNode`) and a dynamic compressor to prevent clipping. 
- **Time-Synced Lyrics**: Automatically fetches and caches time-synced lyrics (LRC) via the `lrclib.net` API, with a dedicated scrolling lyrics view.
- **Inline Tag Editing**: Modify the ID3/Vorbis tags (Title, Artist, Album) of your audio files directly from the UI, with changes instantly reflected in the FTS search index via SQLite triggers.
- **Drag-and-Drop Queue**: Easily reorder your upcoming playback queue.

## 🛠️ Tech Stack

**Frontend:**
- React (Vite)
- Zustand (State management with persistence)
- `@tanstack/react-virtual` (Virtualization)
- `@dnd-kit` (Drag and Drop)
- Phosphor Icons

**Backend:**
- Rust / Tauri V2
- `rusqlite` (SQLite database)
- `lofty` (Audio metadata and tag parsing)
- `reqwest` (HTTP client for lyrics)

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
The UI adheres to a modern, dark-mode-first Oklch color system, featuring glassmorphism elements, high-density 44px rows, and strict visual tokens across all components.
