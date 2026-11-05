import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, ListPlus } from '@phosphor-icons/react';
import { Track } from '../store/library';

interface Playlist {
  id: number;
  name: string;
  created_at: number;
}

interface Props {
  track: Track;
  onClose: () => void;
}

export function AddToPlaylistModal({ track, onClose }: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [error, setError] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    invoke('get_playlists').then((p: any) => setPlaylists(p)).catch(e => console.error(e));
  }, []);

  const handleAdd = async (playlistId: number) => {
    try {
      setIsAdding(true);
      setError('');
      await invoke('add_to_playlist', { playlistId, trackId: track.id });
      onClose();
    } catch (err: any) {
      setError(err.toString());
      setIsAdding(false);
    }
  };

  const title = track.title || track.path.split(/[\\/]/).pop() || '';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Add to playlist</h3>
            <p className="modal-subtitle" title={title}>{title}</p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="playlist-pick-list">
          {playlists.map(p => (
            <button
              key={p.id}
              className="playlist-pick-item"
              disabled={isAdding}
              onClick={() => handleAdd(p.id)}
            >
              <ListPlus size={15} />
              <span>{p.name}</span>
            </button>
          ))}
          {playlists.length === 0 && (
            <div className="playlist-pick-empty">
              No playlists yet. Create one from the Playlists page.
            </div>
          )}
        </div>

        {error && <div className="move-error">{error}</div>}
      </div>
    </div>
  );
}
