import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Track, useLibraryStore } from '../store/library';
import { X } from '@phosphor-icons/react';

export function TagEditor({ track, onClose }: { track: Track; onClose: () => void }) {
  const [title, setTitle] = useState(track.title || '');
  const [artist, setArtist] = useState(track.artist || '');
  const [album, setAlbum] = useState(track.album || '');
  const [isSaving, setIsSaving] = useState(false);
  const { loadTracks } = useLibraryStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSave();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [title, artist, album]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await invoke('update_track_tags', {
        trackId: track.id,
        path: track.path,
        title,
        artist,
        album,
      });
      await loadTracks();
      onClose();
    } catch (e) {
      console.error('Failed to update tags:', e);
      setIsSaving(false);
    }
  };

  const fileName = track.path.split(/[\\/]/).pop() || '';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Track Info</h3>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary)',
                maxWidth: 280,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 2,
              }}
              title={fileName}
            >
              {fileName}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="form-group">
          <label className="form-label">Title</label>
          <input
            type="text"
            className="form-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label className="form-label">Artist</label>
          <input
            type="text"
            className="form-input"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Album</label>
          <input
            type="text"
            className="form-input"
            value={album}
            onChange={(e) => setAlbum(e.target.value)}
            placeholder="Album"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button className="btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
