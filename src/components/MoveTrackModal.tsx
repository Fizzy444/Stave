import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, FolderOpen } from '@phosphor-icons/react';
import { Track, useLibraryStore } from '../store/library';

interface Props {
  track: Track;
  folders: string[];
  onClose: () => void;
}

export function MoveTrackModal({ track, folders, onClose }: Props) {
  const [selectedFolder, setSelectedFolder] = useState<string>(folders.length > 0 ? folders[0] : '');
  const [isCustom, setIsCustom] = useState(false);
  const [customFolder, setCustomFolder] = useState('');
  const [error, setError] = useState('');
  const [isMoving, setIsMoving] = useState(false);
  const loadTracks = useLibraryStore(s => s.loadTracks);

  const handleMove = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetFolder = isCustom ? customFolder : selectedFolder;
    if (!targetFolder) {
      setError('Please select or enter a folder path.');
      return;
    }

    try {
      setIsMoving(true);
      setError('');
      await invoke('move_track', { trackId: track.id, newFolder: targetFolder });
      await loadTracks(); // refresh library
      onClose();
    } catch (err: any) {
      setError(err.toString());
      setIsMoving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderOpen size={20} /> Move Track
          </h3>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Moving: <strong style={{ color: 'var(--text-primary)' }}>{track.title || track.path.split(/[\\/]/).pop()}</strong>
          </p>

          <form onSubmit={handleMove} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)' }}>Destination Folder</label>
              <select
                value={isCustom ? 'custom' : selectedFolder}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setIsCustom(true);
                  } else {
                    setIsCustom(false);
                    setSelectedFolder(e.target.value);
                  }
                }}
                className="form-input"
                style={{ appearance: 'none', backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23999%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '10px auto', paddingRight: '32px' }}
              >
                {folders.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
                <option value="custom">Custom Path...</option>
              </select>
            </div>

            {isCustom && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)' }}>Custom Absolute Path</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. C:\Music\NewFolder"
                  value={customFolder}
                  onChange={(e) => setCustomFolder(e.target.value)}
                  autoFocus
                />
              </div>
            )}

            {error && <div style={{ color: '#f87171', fontSize: '13px' }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: 'transparent', color: 'var(--text-secondary)', padding: '8px 16px',
                  border: 'none', borderRadius: '4px', fontWeight: 500, cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isMoving}
                style={{
                  background: 'var(--accent)', color: '#000', padding: '8px 16px',
                  border: 'none', borderRadius: '4px', fontWeight: 600, cursor: 'pointer'
                }}
              >
                {isMoving ? 'Moving...' : 'Move'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
