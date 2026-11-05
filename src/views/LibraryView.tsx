import { useLibraryStore, Track, getArtworkUrl } from '../store/library';
import { usePlayerStore } from '../store/player';
import { useState, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Disc, 
  PencilSimple, 
  Plus, 
  FolderOpen, 
  ListPlus, 
  Trash, 
  Play, 
  Shuffle, 
  MagicWand,
  MagnifyingGlass,
  FolderSimplePlus,
  ArrowsClockwise,
  X
} from '@phosphor-icons/react';
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

export interface LibraryViewProps {
  onScanFolder?: () => void;
}

export function LibraryView({ onScanFolder }: LibraryViewProps = {}) {
  const { tracks, loadTracks, rescanLibrary } = useLibraryStore(useShallow(state => ({ 
    tracks: state.tracks, 
    loadTracks: state.loadTracks,
    rescanLibrary: state.rescanLibrary
  })));
  const { playContext, queue, currentIndex, isPlaying, addToQueue, playNext } = usePlayerStore(useShallow(state => ({
    playContext: state.playContext,
    queue: state.queue,
    currentIndex: state.currentIndex,
    isPlaying: state.isPlaying,
    addToQueue: state.addToQueue,
    playNext: state.playNext,
  })));

  const [localSearch, setLocalSearch] = useState<string>('');
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

    if (localSearch.trim()) {
      const q = localSearch.trim().toLowerCase();
      filtered = filtered.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q)) ||
        (t.path && t.path.toLowerCase().includes(q))
      );
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
  }, [tracks, activeFolder, sortCol, sortAsc, localSearch]);

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
        playContext(displayedTracks, index, { contextLabel: activeFolder === 'All' ? 'Songs' : activeFolder });
      }
    }
    
    setSelectedIds(newSelection);
    setLastSelectedId(track.id);
  };

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
    estimateSize: () => 34,
    overscan: 12,
  });

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="view-header" style={{ paddingBottom: '0', flexShrink: 0 }}>
            <div className="library-instrument-toolbar">
              <div className="library-toolbar-title-group">
                <h1 className="library-toolbar-title">Songs</h1>
                <span className="library-toolbar-stats">
                  {displayedTracks.length} of {tracks.length} songs
                  {folders.length > 0 ? ` · ${folders.length} ${folders.length === 1 ? 'folder' : 'folders'}` : ''}
                </span>
              </div>

              {/* Local Search + Actions */}
              <div className="library-toolbar-actions">
                <div className="library-quick-search">
                  <MagnifyingGlass size={13} className="search-icon" />
                  <input
                    type="text"
                    placeholder="Search songs"
                    value={localSearch}
                    onChange={(e) => setLocalSearch(e.target.value)}
                  />
                  {localSearch && (
                    <button onClick={() => setLocalSearch('')} className="clear-btn">
                      <X size={12} />
                    </button>
                  )}
                </div>

                {onScanFolder && (
                  <button
                    className="btn-secondary"
                    onClick={onScanFolder}
                    title="Add a music folder"
                  >
                    <FolderSimplePlus size={14} />
                    <span>Add folder</span>
                  </button>
                )}

                <button
                  className="btn-secondary"
                  onClick={() => rescanLibrary()}
                  title="Refresh library"
                >
                  <ArrowsClockwise size={14} />
                  <span>Refresh</span>
                </button>

                <button 
                  className="btn-primary" 
                  onClick={() => displayedTracks.length > 0 && playContext(displayedTracks, 0, { contextLabel: activeFolder === 'All' ? 'Songs' : activeFolder })}
                >
                  <Play size={13} weight="fill" />
                  <span>Play all</span>
                </button>
                <button 
                  className="btn-secondary" 
                  onClick={() => {
                    if (displayedTracks.length === 0) return;
                    const shuffled = [...displayedTracks].sort(() => 0.5 - Math.random());
                    playContext(shuffled, 0, { contextLabel: activeFolder === 'All' ? 'Songs' : activeFolder });
                  }}
                >
                  <Shuffle size={13} weight="bold" />
                  <span>Shuffle</span>
                </button>
              </div>
            </div>

            {/* Folder Filter Bar */}
            <div className="library-folder-bar hide-scrollbar">
              <button
                className={`library-folder-chip ${activeFolder === 'All' ? 'active' : ''}`}
                onClick={() => setActiveFolder('All')}
              >
                <span>All</span>
                <span className="chip-count">{tracks.length}</span>
              </button>
              {folders.map(([folder, count]) => (
                <button
                  key={folder}
                  className={`library-folder-chip ${activeFolder === folder ? 'active' : ''}`}
                  onClick={() => setActiveFolder(folder)}
                >
                  <span>{folder}</span>
                  <span className="chip-count">{count}</span>
                </button>
              ))}
            </div>

            {/* Table Header */}
            <div className="library-table-header">
              <div className="col-idx">#</div>
              <div className="col-title" onClick={() => handleSort('title')}>
                Title {sortCol === 'title' && (sortAsc ? '↑' : '↓')}
              </div>
              <div className="col-artist">Artist</div>
              <div className="col-album" onClick={() => handleSort('album')}>
                Album {sortCol === 'album' && (sortAsc ? '↑' : '↓')}
              </div>
              <div className="col-fmt">Format</div>
              <div className="col-date" onClick={() => handleSort('date_added')}>
                Added {sortCol === 'date_added' && (sortAsc ? '↑' : '↓')}
              </div>
              <div className="col-time" onClick={() => handleSort('duration')}>
                Time {sortCol === 'duration' && (sortAsc ? '↑' : '↓')}
              </div>
            </div>
          </div>

          {/* Table Body */}
          <div 
            ref={parentRef}
            className="view-content"
            onClick={handleBlankClick}
            style={{ 
              flex: 1, 
              overflowY: 'auto',
              padding: '0 0 24px 0'
            }}
          >
            {displayedTracks.length === 0 ? (
              <div className="view-empty">
                <p>
                  {localSearch
                    ? `No songs match “${localSearch}”.`
                    : 'No songs here yet. Add a folder to get started.'}
                </p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map(virtualRow => {
                  const track = displayedTracks[virtualRow.index];
                  const isCurrent = track.id === currentTrackId;
                  const isSelected = selectedIds.has(track.id);
                  const isYt = track.source === 'youtube'
                    || (track.path != null && track.path.startsWith('yt:'))
                    || (typeof track.id === 'string' && track.id.startsWith('yt_'));
                  const ext = isYt ? null : (track.path && !track.path.startsWith('http') ? (track.path.split('.').pop()?.toUpperCase() || 'PCM') : null);
                  const isLossless = ext ? ['FLAC', 'WAV', 'ALAC', 'AIFF'].includes(ext) : false;

                  return (
                    <div
                      key={track.id}
                      className={`library-row ${isCurrent ? 'is-active' : ''} ${isSelected ? 'selected' : ''}`}
                      onClick={(e) => handleRowClick(e, track, virtualRow.index)}
                      onContextMenu={(e) => handleContextMenu(e, track)}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <div className="col-idx">
                        {isCurrent && isPlaying ? (
                          <Play size={11} weight="fill" color="var(--accent)" />
                        ) : (
                          virtualRow.index + 1
                        )}
                      </div>

                      <div className="col-title">
                        <div className="track-thumb-mini">
                          {track.art_hash ? (
                            <img 
                              src={getArtworkUrl(track.art_hash) || ''} 
                              alt="" 
                            />
                          ) : (
                            <Disc size={13} color="var(--text-dim)" />
                          )}
                        </div>
                        <span className="track-title-cell" title={track.title || (isYt ? 'YouTube track' : track.path.split(/[\\/]/).pop())}>
                          {track.title || (isYt ? 'YouTube track' : track.path.split(/[\\/]/).pop())}
                        </span>
                      </div>

                      <div className="col-artist" title={track.artist || 'Unknown artist'}>
                        {track.artist || 'Unknown artist'}
                      </div>

                      <div className="col-album" title={isYt ? '' : (track.album || 'Unknown album')}>
                        {isYt ? '' : (track.album || 'Unknown album')}
                      </div>

                      <div className="col-fmt">
                        {ext && (
                          <span className={`track-fmt-tag ${isLossless ? 'lossless' : ''}`}>
                            {ext}
                          </span>
                        )}
                      </div>

                      <div className="col-date">
                        {track.mtime ? formatDate(track.mtime) : '--'}
                      </div>

                      <div className="col-time">
                        <button
                          className="row-action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            addToQueue(track);
                          }}
                          title="Add to queue"
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          className="row-action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTrack(track);
                          }}
                          title="Edit song info"
                        >
                          <PencilSimple size={12} />
                        </button>
                        <span className="duration-text">
                          {track.duration_ms ? formatDuration(track.duration_ms) : '--:--'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

      {/* Editing Modals */}
      {editingTrack && (
        <TagEditor
          track={editingTrack}
          onClose={() => {
            setEditingTrack(null);
            loadTracks();
          }}
        />
      )}

      {playlistTrack && (
        <AddToPlaylistModal
          track={playlistTrack}
          onClose={() => setPlaylistTrack(null)}
        />
      )}

      {movingTrack && (
        <MoveTrackModal
          track={movingTrack}
          folders={absoluteFolders}
          onClose={() => {
            setMovingTrack(null);
            loadTracks();
          }}
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
                const idx = displayedTracks.findIndex(t => t.id === contextMenu.tracks[0].id);
                if (idx !== -1) playContext(displayedTracks, idx, { contextLabel: activeFolder === 'All' ? 'Songs' : activeFolder });
              }
            },
            {
              label: 'Play next',
              icon: <Play size={16} />,
              onClick: () => {
                for (let k = contextMenu.tracks.length - 1; k >= 0; k--) {
                  playNext(contextMenu.tracks[k]);
                }
              }
            },
            {
              label: 'Add to queue',
              icon: <Plus size={16} />,
              onClick: () => {
                for (const t of contextMenu.tracks) addToQueue(t);
              }
            },
            { divider: true, label: '', onClick: () => {} },
            {
              label: 'Add to playlist…',
              icon: <ListPlus size={16} />,
              onClick: () => {
                if (contextMenu.tracks.length === 1) {
                  setPlaylistTrack(contextMenu.tracks[0]);
                }
              }
            },
            {
              label: 'Move file…',
              icon: <FolderOpen size={16} />,
              onClick: () => setMovingTrack(contextMenu.tracks[0])
            },
            { divider: true, label: '', onClick: () => {} },
            {
              label: 'Edit song info…',
              icon: <PencilSimple size={16} />,
              onClick: () => setEditingTrack(contextMenu.tracks[0])
            },
            {
              label: 'Auto-fix metadata',
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
              label: 'Delete from computer',
              icon: <Trash size={16} />,
              danger: true,
              onClick: async () => {
                if (window.confirm(`Are you sure you want to permanently delete "${contextMenu.tracks[0].title || 'this song'}" from your computer?`)) {
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
