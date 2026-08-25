import { useLibraryStore, Track, getArtworkUrl } from '../store/library';
import { usePlayerStore } from '../store/player';
import { useState, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Clock, Disc, PencilSimple, Plus, FolderOpen, ListPlus, Trash, Play, Shuffle, MagicWand } from '@phosphor-icons/react';
import { TagEditor } from '../components/TagEditor';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { ContextMenu } from '../components/ContextMenu';
import { MoveTrackModal } from '../components/MoveTrackModal';
import { invoke } from '@tauri-apps/api/core';

const getFolderName = (path: string) => {
  const parts = path.split(/[\\/]/);
  if (parts.length >= 2) return parts[parts.length - 2];
  return 'Unknown';
};

const formatDate = (secs: number) => {
  const d = new Date(secs * 1000);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatDuration = (ms: number) => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export function LibraryView() {
  const { tracks, loadTracks } = useLibraryStore(useShallow(state => ({ tracks: state.tracks, loadTracks: state.loadTracks })));
  const { playContext, queue, currentIndex, isPlaying, addToQueue } = usePlayerStore(useShallow(state => ({
    playContext: state.playContext,
    queue: state.queue,
    currentIndex: state.currentIndex,
    isPlaying: state.isPlaying,
    addToQueue: state.addToQueue
  })));

  const [activeFolder, setActiveFolder] = useState<string>('All');
  const [sortCol, setSortCol] = useState<'title' | 'album' | 'date_added' | 'duration' | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [movingTrack, setMovingTrack] = useState<Track | null>(null);
  const [playlistTrack, setPlaylistTrack] = useState<Track | null>(null);
  
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tracks: Track[] } | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);

  const folders = useMemo(() => {
    const f: Record<string, number> = {};
    for (const t of tracks) {
      const fn = getFolderName(t.path);
      f[fn] = (f[fn] || 0) + 1;
    }
    return Object.entries(f).sort((a, b) => a[0].localeCompare(b[0]));
  }, [tracks]);

  const absoluteFolders = useMemo(() => {
    const f = new Set<string>();
    for (const t of tracks) {
      const parts = t.path.split(/[\\/]/);
      parts.pop();
      f.add(parts.join(t.path.includes('\\') ? '\\' : '/'));
    }
    return Array.from(f).sort();
  }, [tracks]);

  const displayedTracks = useMemo(() => {
    let filtered = tracks;
    if (activeFolder !== 'All') {
      filtered = tracks.filter(t => getFolderName(t.path) === activeFolder);
    }

    if (sortCol) {
      filtered = [...filtered].sort((a, b) => {
        let valA: any = 0;
        let valB: any = 0;

        if (sortCol === 'title') {
          valA = (a.title || a.path.split(/[\\/]/).pop() || '').toLowerCase();
          valB = (b.title || b.path.split(/[\\/]/).pop() || '').toLowerCase();
        } else if (sortCol === 'album') {
          valA = (a.album || '').toLowerCase();
          valB = (b.album || '').toLowerCase();
        } else if (sortCol === 'date_added') {
          valA = a.mtime || 0;
          valB = b.mtime || 0;
        } else if (sortCol === 'duration') {
          valA = a.duration_ms || 0;
          valB = b.duration_ms || 0;
        }

        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [tracks, activeFolder, sortCol, sortAsc]);

  const handleSort = (col: 'title' | 'album' | 'date_added' | 'duration') => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  const handleRowClick = (e: React.MouseEvent, track: Track, index: number) => {
    e.stopPropagation();
    if (contextMenu) setContextMenu(null);
    
    let newSelection = new Set(selectedIds);
    if (e.shiftKey && lastSelectedId !== null) {
      const lastIndex = displayedTracks.findIndex(t => t.id === lastSelectedId);
      if (lastIndex !== -1) {
        const start = Math.min(index, lastIndex);
        const end = Math.max(index, lastIndex);
        newSelection = new Set(e.ctrlKey || e.metaKey ? selectedIds : []);
        for (let i = start; i <= end; i++) {
          newSelection.add(displayedTracks[i].id);
        }
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (newSelection.has(track.id)) {
        newSelection.delete(track.id);
      } else {
        newSelection.add(track.id);
      }
    } else {
      if (isSelectMode) {
        if (newSelection.has(track.id)) {
          newSelection.delete(track.id);
          if (newSelection.size === 0) setIsSelectMode(false);
        } else {
          newSelection.add(track.id);
        }
      } else {
        newSelection = new Set([track.id]);
        playContext(displayedTracks, index);
      }
    }
    
    setSelectedIds(newSelection);
    setLastSelectedId(track.id);
  };

  // Exit select mode when clicking blank space
  const handleBlankClick = () => {
    if (isSelectMode) {
      setIsSelectMode(false);
      setSelectedIds(new Set());
    }
  };

  const handleContextMenu = (e: React.MouseEvent, track: Track) => {
    e.preventDefault();
    e.stopPropagation();
    
    let currentSelection = selectedIds;
    if (!selectedIds.has(track.id)) {
      currentSelection = new Set([track.id]);
      setSelectedIds(currentSelection);
      setLastSelectedId(track.id);
    }
    
    const selectedTracks = displayedTracks.filter(t => currentSelection.has(t.id));
    
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      tracks: selectedTracks
    });
  };

  const currentTrackId = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex].id : null;

  const rowVirtualizer = useVirtualizer({
    count: displayedTracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="view-header" style={{ paddingBottom: '0', flexShrink: 0 }}>
        <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <h2 style={{ fontSize: '28px', fontWeight: 700, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
              Your Library
            </h2>
            <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', fontWeight: 500 }}>
              {tracks.length} tracks • {folders.length} folders
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              className="btn-secondary" 
              onClick={() => displayedTracks.length > 0 && playContext(displayedTracks, 0)}
              style={{ padding: '8px 16px', gap: '8px', color: 'var(--text-primary)' }}
            >
              <Play size={16} weight="fill" />
              <span style={{ fontWeight: 600 }}>Play All</span>
            </button>
            <button 
              className="btn-secondary" 
              onClick={() => {
                if (displayedTracks.length === 0) return;
                const shuffled = [...displayedTracks].sort(() => 0.5 - Math.random());
                playContext(shuffled, 0);
              }}
              style={{ padding: '8px 16px', gap: '8px', color: 'var(--text-primary)' }}
            >
              <Shuffle size={16} weight="bold" />
              <span style={{ fontWeight: 600 }}>Shuffle</span>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="hide-scrollbar" style={{ display: 'flex', gap: '24px', overflowX: 'auto', borderBottom: '1px solid var(--divider-subtle)', marginBottom: '24px' }}>
          <div
            onClick={() => setActiveFolder('All')}
            style={{
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: activeFolder === 'All' ? 700 : 500,
              color: activeFolder === 'All' ? 'var(--text-primary)' : 'var(--text-tertiary)',
              borderBottom: activeFolder === 'All' ? '2px solid var(--text-primary)' : '2px solid transparent',
              paddingBottom: '12px',
              marginBottom: '-1px',
              whiteSpace: 'nowrap',
              transition: 'color 0.2s'
            }}
          >
            All <span style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginLeft: '6px', fontWeight: 500 }}>{tracks.length}</span>
          </div>
          {folders.map(([folder, count]) => (
            <div
              key={folder}
              onClick={() => setActiveFolder(folder)}
              style={{
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: activeFolder === folder ? 700 : 500,
                color: activeFolder === folder ? 'var(--text-primary)' : 'var(--text-tertiary)',
                borderBottom: activeFolder === folder ? '2px solid var(--text-primary)' : '2px solid transparent',
                paddingBottom: '12px',
                marginBottom: '-1px',
                whiteSpace: 'nowrap',
                transition: 'color 0.2s'
              }}
            >
              {folder} <span style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginLeft: '6px', fontWeight: 500 }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="view-content" onClick={handleBlankClick} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>

        {/* Table Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '40px minmax(200px, 2fr) minmax(150px, 1.5fr) minmax(100px, 1fr) 50px',
          gap: '16px',
          padding: '0 16px',
          margin: '0 16px 8px 16px',
          height: '36px',
          alignItems: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          borderRadius: '4px',
          fontSize: '11px',
          color: 'var(--text-tertiary)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          flexShrink: 0
        }}>
          <div style={{ textAlign: 'center' }}>#</div>
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', paddingLeft: '52px' }} onClick={() => handleSort('title')}>
            TITLE {sortCol === 'title' && (sortAsc ? '▲' : '▼')}
          </div>
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleSort('album')}>
            ALBUM {sortCol === 'album' && (sortAsc ? '▲' : '▼')}
          </div>
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleSort('date_added')}>
            DATE ADDED {sortCol === 'date_added' && (sortAsc ? '▲' : '▼')}
          </div>
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }} onClick={() => handleSort('duration')}>
            <Clock size={14} /> {sortCol === 'duration' && (sortAsc ? '▲' : '▼')}
          </div>
        </div>

        {/* Scrollable Tracks */}
        <div ref={parentRef} style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative', paddingBottom: '32px' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const i = virtualRow.index;
              const track = displayedTracks[i];
              const isCurrent = currentTrackId === track.id;
              const isThisPlaying = isCurrent && isPlaying;
              const title = track.title || track.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Unknown Title';
              const isSelected = selectedIds.has(track.id);

              return (
                <div
                  key={track.id}
                  className={`library-row ${isCurrent ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}`}
                  onClick={(e) => handleRowClick(e, track, i)}
                  onContextMenu={(e) => handleContextMenu(e, track)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'grid',
                    gridTemplateColumns: '40px minmax(200px, 2fr) minmax(150px, 1.5fr) minmax(100px, 1fr) 50px',
                    gap: '16px',
                    alignItems: 'center',
                    height: `${virtualRow.size}px`,
                    borderRadius: '6px',
                    padding: '0 16px',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s',
                    backgroundColor: isSelected ? 'var(--surface-selected)' : (isCurrent ? 'rgba(255,255,255,0.05)' : 'transparent'),
                  }}
                  onMouseEnter={(e) => { if (!isSelected && !isCurrent) e.currentTarget.style.backgroundColor = 'var(--surface-hover)' }}
                  onMouseLeave={(e) => { if (!isSelected && !isCurrent) e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  <div style={{ textAlign: 'center', fontSize: '14px', color: isCurrent ? 'var(--accent)' : 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {isThisPlaying ? '▶' : i + 1}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <div style={{ width: '40px', height: '40px', flexShrink: 0, borderRadius: '4px', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {track.art_hash ? <img src={getArtworkUrl(track.art_hash) || ''} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Disc size={20} color="var(--text-tertiary)" />}
                    </div>
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px' }}>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: isCurrent ? 'var(--accent)' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {title}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {track.artist || 'Unknown Artist'}
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {track.album || ''}
                  </div>

                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {track.mtime ? formatDate(track.mtime) : ''}
                  </div>

                  <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                    <div style={{ width: '35px', textAlign: 'right' }}>
                      {track.duration_ms ? formatDuration(track.duration_ms) : '--:--'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {editingTrack && (
        <TagEditor
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
        />
      )}
      {movingTrack && (
        <MoveTrackModal
          track={movingTrack}
          folders={absoluteFolders}
          onClose={() => setMovingTrack(null)}
        />
      )}
      {playlistTrack && (
        <AddToPlaylistModal
          track={playlistTrack}
          onClose={() => setPlaylistTrack(null)}
        />
      )}
      
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Play',
              icon: <Disc size={16} />,
              onClick: () => {
                const index = displayedTracks.findIndex(t => t.id === contextMenu.tracks[0].id);
                if (index !== -1) playContext(displayedTracks, index);
                setIsSelectMode(false);
              }
            },
            {
              label: isSelectMode ? 'Exit Select Mode' : 'Select',
              icon: <ListPlus size={16} />,
              onClick: () => {
                if (!isSelectMode) {
                  setIsSelectMode(true);
                } else {
                  setIsSelectMode(false);
                  setSelectedIds(new Set());
                }
              }
            },
            {
              label: 'Add to Up Next',
              icon: <Plus size={16} />,
              onClick: () => contextMenu.tracks.forEach(t => addToQueue(t))
            },
            { divider: true, label: '', onClick: () => {} },
            {
              label: 'Add to Playlist...',
              icon: <ListPlus size={16} />,
              onClick: () => {
                // For multiple, we could loop or implement bulk add. For now just first item or handle bulk later
                setPlaylistTrack(contextMenu.tracks[0]); 
              }
            },
            {
              label: 'Move File...',
              icon: <FolderOpen size={16} />,
              onClick: () => setMovingTrack(contextMenu.tracks[0])
            },
            { divider: true, label: '', onClick: () => {} },
            {
              label: 'Edit Metadata...',
              icon: <PencilSimple size={16} />,
              onClick: () => setEditingTrack(contextMenu.tracks[0])
            },
            {
              label: 'Auto-Fix Metadata',
              icon: <MagicWand size={16} />,
              onClick: async () => {
                const trackIds = contextMenu.tracks.map(t => t.id);
                try {
                  await invoke('auto_fix_metadata', { forceAll: true, trackIds });
                  await loadTracks();
                } catch (e) {
                  console.error("Failed to fix metadata:", e);
                  alert("Could not fix metadata: " + e);
                }
              }
            },
            { divider: true, label: '', onClick: () => {} },
            {
              label: 'Delete from disk',
              icon: <Trash size={16} />,
              danger: true,
              onClick: async () => {
                if (window.confirm(`Are you sure you want to permanently delete "${contextMenu.tracks[0].title || 'this song'}" from your disk?`)) {
                  try {
                    await invoke('delete_track', { trackId: contextMenu.tracks[0].id });
                    await loadTracks();
                  } catch (e) {
                    console.error("Failed to delete track:", e);
                    alert("Could not delete file: " + e);
                  }
                }
              }
            }
          ]}
        />
      )}
    </div>
  );
}
