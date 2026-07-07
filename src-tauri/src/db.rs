use rusqlite::{Connection, Result};
use std::path::PathBuf;

pub fn init(app_data_dir: PathBuf) -> Result<Connection> {
    std::fs::create_dir_all(&app_data_dir).ok();
    let db_path = app_data_dir.join("library.db");
    let conn = Connection::open(db_path)?;

    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        
        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            added_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            title TEXT,
            artist TEXT,
            album_artist TEXT,
            album TEXT,
            year INTEGER,
            track_no INTEGER,
            disc_no INTEGER,
            genre TEXT,
            duration_ms INTEGER,
            bitrate INTEGER,
            sample_rate INTEGER,
            art_hash TEXT,
            accent TEXT,
            mtime INTEGER,
            size INTEGER,
            play_count INTEGER DEFAULT 0,
            last_played INTEGER,
            favorite INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_mtime ON tracks(mtime);

        CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
            title, artist, album, content='tracks', content_rowid='id'
        );
        CREATE TABLE IF NOT EXISTS eq_presets (
            name TEXT PRIMARY KEY,
            gains TEXT NOT NULL,
            preamp REAL DEFAULT 0,
            builtin INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS lyrics_cache (
            track_id INTEGER PRIMARY KEY,
            synced TEXT,
            plain TEXT,
            source TEXT,
            fetched_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS downloads (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            title TEXT,
            artist TEXT,
            status TEXT DEFAULT 'queued',
            progress REAL DEFAULT 0,
            added_at INTEGER,
            completed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            created_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id INTEGER,
            track_id INTEGER,
            position INTEGER,
            PRIMARY KEY (playlist_id, track_id),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );
        
        CREATE TRIGGER IF NOT EXISTS tracks_ai AFTER INSERT ON tracks BEGIN
            INSERT INTO tracks_fts(rowid, title, artist, album)
            VALUES (new.id, new.title, new.artist, new.album);
        END;
        CREATE TRIGGER IF NOT EXISTS tracks_ad AFTER DELETE ON tracks BEGIN
            INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album) 
            VALUES('delete', old.id, old.title, old.artist, old.album);
        END;
        CREATE TRIGGER IF NOT EXISTS tracks_au AFTER UPDATE ON tracks BEGIN
            INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album) 
            VALUES('delete', old.id, old.title, old.artist, old.album);
            INSERT INTO tracks_fts(rowid, title, artist, album)
            VALUES (new.id, new.title, new.artist, new.album);
        END;
        ",
    )?;

    Ok(conn)
}
