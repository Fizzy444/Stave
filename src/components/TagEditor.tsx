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
            <h3 className="modal-title">Edit song info</h3>
            <p className="modal-subtitle" title={fileName}>{fileName}</p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="edit-title">Title</label>
          <input
            id="edit-title"
            type="text"
            className="form-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="edit-artist">Artist</label>
          <input
            id="edit-artist"
            type="text"
            className="form-input"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="edit-album">Album</label>
          <input
            id="edit-album"
            type="text"
            className="form-input"
            value={album}
            onChange={(e) => setAlbum(e.target.value)}
            placeholder="Album"
          />
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
