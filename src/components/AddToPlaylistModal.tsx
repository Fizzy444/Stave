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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ListPlus size={20} /> Add to Playlist
          </h3>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Adding: <strong style={{ color: 'var(--text-primary)' }}>{track.title || track.path.split(/[\\/]/).pop()}</strong>
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
            {playlists.map(p => (
              <button
                key={p.id}
                disabled={isAdding}
                onClick={() => handleAdd(p.id)}
                style={{
                  background: 'var(--surface-hover)', color: 'var(--text-primary)', padding: '12px 16px',
                  border: 'none', borderRadius: '4px', fontWeight: 500, cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: '12px'
                }}
              >
                <ListPlus size={16} />
                {p.name}
              </button>
            ))}
            {playlists.length === 0 && (
              <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', textAlign: 'center', padding: '16px' }}>
                No playlists available. Create one in the Playlists tab.
              </div>
            )}
          </div>

          {error && <div style={{ color: '#f87171', fontSize: '13px', marginTop: '16px' }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}
