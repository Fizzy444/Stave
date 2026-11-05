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
      setError('Choose a folder first.');
      return;
    }

    try {
      setIsMoving(true);
      setError('');
      await invoke('move_track', { trackId: track.id, newFolder: targetFolder });
      await loadTracks();
      onClose();
    } catch (err: any) {
      setError(err.toString());
      setIsMoving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Move song</h3>
            <p className="modal-subtitle">
              {track.title || track.path.split(/[\\/]/).pop()}
            </p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleMove} className="move-form">
          <div className="form-group">
            <label className="form-label" htmlFor="move-folder">Folder</label>
            <div className="move-folder-row">
              <FolderOpen size={15} className="move-folder-icon" />
              <select
                id="move-folder"
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
              >
                {folders.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
                <option value="custom">Other folder…</option>
              </select>
            </div>
          </div>

          {isCustom && (
            <div className="form-group">
              <label className="form-label" htmlFor="move-custom-path">Folder path</label>
              <input
                id="move-custom-path"
                type="text"
                className="form-input"
                placeholder="e.g. C:\Music\New folder"
                value={customFolder}
                onChange={(e) => setCustomFolder(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {error && <div className="move-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isMoving}>
              {isMoving ? 'Moving…' : 'Move song'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
