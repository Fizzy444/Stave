import { useState } from 'react';
import { useLibraryStore } from '../store/library';
import { X, CircleNotch, FolderOpen } from '@phosphor-icons/react';
import { open } from '@tauri-apps/plugin-dialog';

interface ScanModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ScanModal({ isOpen, onClose }: ScanModalProps) {
  const [folderPath, setFolderPath] = useState('');
  const { scanFolder, isScanning, tracks } = useLibraryStore();

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

  const presetPaths = [
    'C:\\Users\\Mithun\\Music',
    'D:\\Music',
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Add Folder</h3>
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 2 }}>
              Index music files into your local library
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="form-group">
          <label className="form-label">Folder Path</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="form-input"
              style={{ flex: 1 }}
              placeholder="e.g. C:\Users\Mithun\Music"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleScan(folderPath);
                if (e.key === 'Escape') onClose();
              }}
              autoFocus
            />
            <button 
              className="btn-secondary" 
              style={{ padding: '0 12px' }} 
              onClick={handleSelectFolder}
              title="Browse for folder"
            >
              <FolderOpen size={18} />
            </button>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }}>
            Quick Paths
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {presetPaths.map((p) => (
              <button
                key={p}
                className="btn-secondary"
                style={{ fontSize: 11.5, height: 26, padding: '0 8px' }}
                onClick={() => {
                  setFolderPath(p);
                  handleScan(p);
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            {tracks.length > 0 && `${tracks.length} tracks indexed`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
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
                  <span>Scanning...</span>
                </>
              ) : (
                'Scan'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
