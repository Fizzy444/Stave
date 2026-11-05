import { useState, useEffect } from 'react';
import { useLibraryStore } from '../store/library';
import { X, CircleNotch, FolderOpen } from '@phosphor-icons/react';
import { open } from '@tauri-apps/plugin-dialog';
import { audioDir } from '@tauri-apps/api/path';

interface ScanModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ScanModal({ isOpen, onClose }: ScanModalProps) {
  const [folderPath, setFolderPath] = useState('');
  const [presetPaths, setPresetPaths] = useState<string[]>(['D:\\Music']);
  const { scanFolder, isScanning, tracks } = useLibraryStore();

  useEffect(() => {
    audioDir().then((dir) => {
      setPresetPaths([dir, 'D:\\Music']);
    }).catch(console.error);
  }, []);

  if (!isOpen) return null;

  const handleScan = async (path: string) => {
    if (!path.trim()) return;
    await scanFolder(path.trim());
    onClose();
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: folderPath || undefined
      });
      if (selected && typeof selected === 'string') {
        setFolderPath(selected);
      }
    } catch (err) {
      console.error('Failed to open dialog:', err);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog scan-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header scan-header">
          <div>
            <h3 className="modal-title">Add music</h3>
            <p className="scan-subtitle">Choose a folder to add its songs to your library.</p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="scan-folder">Folder</label>
          <div className="scan-folder-row">
            <input
              id="scan-folder"
              type="text"
              className="form-input"
              placeholder="Paste a folder path, or browse"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleScan(folderPath);
                if (e.key === 'Escape') onClose();
              }}
              autoFocus
            />
            <button
              className="btn-secondary scan-browse-btn"
              onClick={handleSelectFolder}
              title="Choose a folder"
            >
              <FolderOpen size={15} />
              Browse
            </button>
          </div>
        </div>

        {presetPaths.length > 0 && (
          <div className="scan-presets">
            <div className="scan-presets-label">Suggested folders</div>
            <div className="scan-preset-list">
              {presetPaths.map((p) => (
                <button
                  key={p}
                  className="btn-secondary scan-preset"
                  onClick={() => {
                    setFolderPath(p);
                    handleScan(p);
                  }}
                  title={`Scan ${p}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="scan-footer">
          <span className="scan-count">
            {tracks.length === 0
              ? 'No songs yet'
              : `${tracks.length.toLocaleString()} ${tracks.length === 1 ? 'song' : 'songs'} in your library`}
          </span>
          <div className="scan-actions">
            <button className="btn-secondary" onClick={onClose} disabled={isScanning}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={isScanning || !folderPath.trim()}
              onClick={() => handleScan(folderPath)}
            >
              {isScanning ? (
                <>
                  <CircleNotch size={14} className="spinning-icon" />
                  <span>Scanning…</span>
                </>
              ) : (
                'Scan folder'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
