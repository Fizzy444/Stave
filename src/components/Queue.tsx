import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  usePlayerStore,
  trackKey,
  isYouTubeTrack,
  prefetchTrackOnHover,
  QueueOrigin,
} from '../store/player';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Track } from '../store/library';
import { ContextMenu } from './ContextMenu';
import {
  X,
  Play,
  DotsSixVertical,
  Trash,
  Sparkle,
  ArrowsClockwise,
  CaretRight,
  CaretDown,
  YoutubeLogo,
  Plus,
} from '@phosphor-icons/react';
import './Queue.css';

interface QueueItemWithMeta {
  track: Track;
  origin: QueueOrigin;
  absoluteIndex: number;
  dndId: string;
}

function SortableUserTrackRow({
  item,
  onPlay,
  onRemove,
  onContextMenu,
}: {
  item: QueueItemWithMeta;
  onPlay: () => void;
  onRemove: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.dndId,
  });
  const isOnline = isYouTubeTrack(item.track);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="queue-track-row"
      onMouseEnter={() => prefetchTrackOnHover(item.track)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e);
      }}
    >
      <div {...attributes} {...listeners} className="queue-track-drag-handle" title="Drag to reorder">
        <DotsSixVertical size={14} />
      </div>

      <div className="queue-track-main">
        <div className="queue-track-title-row">
          <span className="queue-track-title-text">
            {item.track.title || item.track.path.split(/[\\/]/).pop()}
          </span>
          {isOnline && (
            <span className="queue-yt-tag" title="YouTube">
              <YoutubeLogo size={10} weight="fill" />
              YT
            </span>
          )}
        </div>
        <div className="queue-track-artist-text">{item.track.artist || 'Unknown artist'}</div>
      </div>

      <div className="queue-track-actions">
        <button
          className="btn-icon"
          style={{ width: 24, height: 24 }}
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          title="Play now"
        >
          <Play size={12} weight="fill" />
        </button>

        <button
          className="btn-icon"
          style={{ width: 24, height: 24 }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove from queue"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

function ReadOnlyTrackRow({
  track,
  itemNumber,
  onPlay,
  onRemove,
  onAddToQueue,
  onContextMenu,
}: {
  track: Track;
  itemNumber?: number;
  onPlay: () => void;
  onRemove: () => void;
  onAddToQueue?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const isOnline = isYouTubeTrack(track);

  return (
    <div
      className="queue-track-row"
      onMouseEnter={() => prefetchTrackOnHover(track)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e);
      }}
    >
      {itemNumber !== undefined && (
        <span className="queue-track-num">{itemNumber}</span>
      )}

      <div className="queue-track-main">
        <div className="queue-track-title-row">
          <span className="queue-track-title-text">
            {track.title || track.path.split(/[\\/]/).pop()}
          </span>
          {isOnline && (
            <span className="queue-yt-tag" title="YouTube">
              <YoutubeLogo size={10} weight="fill" />
              YT
            </span>
          )}
        </div>
        <div className="queue-track-artist-text">{track.artist || 'Unknown artist'}</div>
      </div>

      <div className="queue-track-actions">
        {onAddToQueue && (
          <button
            className="btn-icon"
            style={{ width: 24, height: 24 }}
            onClick={(e) => {
              e.stopPropagation();
              onAddToQueue();
            }}
            title="Add to queue"
          >
            <Plus size={12} />
          </button>
        )}

        <button
          className="btn-icon"
          style={{ width: 24, height: 24 }}
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          title="Play now"
        >
          <Play size={12} weight="fill" />
        </button>

        <button
          className="btn-icon"
          style={{ width: 24, height: 24 }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

export function QueuePanel() {
  const [isContextCollapsed, setIsContextCollapsed] = useState<boolean>(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    track: Track;
    absoluteIndex: number;
    origin?: QueueOrigin;
  } | null>(null);

  const {
    queue,
    queueOrigins,
    currentIndex,
    autoPlayEnabled,
    autoPlaySeed,
    autoPlayLoading,
    autoPlayError,
    queueContextLabel,
    playAtIndex,
    removeAt,
    clearUpcoming,
    clearUserQueue,
    reorderUserQueue,
    toggleAutoPlay,
    refreshAutoPlay,
    addToQueue,
    playNext,
  } = usePlayerStore(
    useShallow((s) => ({
      queue: s.queue,
      queueOrigins: s.queueOrigins,
      currentIndex: s.currentIndex,
      autoPlayEnabled: s.autoPlayEnabled,
      autoPlaySeed: s.autoPlaySeed,
      autoPlayLoading: s.autoPlayLoading,
      autoPlayError: s.autoPlayError,
      queueContextLabel: s.queueContextLabel,
      playAtIndex: s.playAtIndex,
      removeAt: s.removeAt,
      clearUpcoming: s.clearUpcoming,
      clearUserQueue: s.clearUserQueue,
      reorderUserQueue: s.reorderUserQueue,
      toggleAutoPlay: s.toggleAutoPlay,
      refreshAutoPlay: s.refreshAutoPlay,
      addToQueue: s.addToQueue,
      playNext: s.playNext,
    }))
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Partition queue items
  const nowPlayingTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  const userItems: QueueItemWithMeta[] = [];
  const contextItems: QueueItemWithMeta[] = [];
  const autoItems: QueueItemWithMeta[] = [];

  for (let i = currentIndex + 1; i < queue.length; i++) {
    const origin = queueOrigins[i] || 'context';
    const item: QueueItemWithMeta = {
      track: queue[i],
      origin,
      absoluteIndex: i,
      dndId: `${trackKey(queue[i])}-${i}`,
    };

    if (origin === 'user') {
      userItems.push(item);
    } else if (origin === 'auto') {
      autoItems.push(item);
    } else {
      contextItems.push(item);
    }
  }

  const upcomingCount = userItems.length + contextItems.length;
  const hasUpcomingQueue = upcomingCount > 0;

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = userItems.findIndex((item) => item.dndId === active.id);
      const newIndex = userItems.findIndex((item) => item.dndId === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderUserQueue(oldIndex, newIndex);
      }
    }
  };

  const displayedContextItems = isContextCollapsed ? contextItems.slice(0, 8) : contextItems;

  if (queue.length === 0) {
    return (
      <div className="queue-panel-container">
        <div className="empty-library-state" style={{ padding: '60px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
            Queue is empty
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4 }}>
            Play a song from Explore, Search, or your library to start listening.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="queue-panel-container">
      {/* 1. Now Playing Section */}
      {nowPlayingTrack && (
        <div className="queue-now-playing-section">
          <div className="queue-section-header" style={{ marginBottom: 4 }}>
            <span className="queue-section-title">Now playing</span>
          </div>
          <div className="queue-now-playing-card">
            <div className="queue-now-playing-indicator">
              <Play size={13} weight="fill" />
            </div>
            <div className="queue-track-main">
              <div className="queue-track-title-row is-current">
                <span className="queue-track-title-text">
                  {nowPlayingTrack.title || nowPlayingTrack.path.split(/[\\/]/).pop()}
                </span>
                {isYouTubeTrack(nowPlayingTrack) && (
                  <span className="queue-yt-tag" title="YouTube">
                    <YoutubeLogo size={11} weight="fill" />
                  </span>
                )}
              </div>
              <div className="queue-track-artist-text">
                {nowPlayingTrack.artist || 'Unknown artist'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Queue Section (Top Half when hasUpcomingQueue is true) */}
      {hasUpcomingQueue && (
        <div className="queue-split-top">
          <div className="queue-section-header-bar">
            <div className="queue-header-left">
              <span>Next up</span>
              <span className="queue-header-badge">{upcomingCount}</span>
            </div>
            <button
              className="queue-clear-btn"
              onClick={clearUpcoming}
              title="Clear upcoming"
            >
              <Trash size={12} />
              <span>Clear</span>
            </button>
          </div>

          <div className="queue-scroll-area hide-scrollbar">
            {/* User manual queue */}
            {userItems.length > 0 && (
              <div className="queue-section">
                <div className="queue-section-header">
                  <span className="queue-section-title">
                    Next in queue ({userItems.length})
                  </span>
                  {userItems.length > 1 && (
                    <button className="queue-section-action-btn" onClick={clearUserQueue} title="Clear manual queue">
                      Clear
                    </button>
                  )}
                </div>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={userItems.map((item) => item.dndId)} strategy={verticalListSortingStrategy}>
                    {userItems.map((item) => (
                      <SortableUserTrackRow
                        key={item.dndId}
                        item={item}
                        onPlay={() => playAtIndex(item.absoluteIndex)}
                        onRemove={() => removeAt(item.absoluteIndex)}
                        onContextMenu={(e) =>
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            track: item.track,
                            absoluteIndex: item.absoluteIndex,
                            origin: 'user',
                          })
                        }
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            )}

            {/* Context remainder */}
            {contextItems.length > 0 && (
              <div className="queue-section">
                <div className="queue-section-header">
                  <span
                    className="queue-section-title"
                    style={{ cursor: contextItems.length > 8 ? 'pointer' : 'default' }}
                    onClick={() => contextItems.length > 8 && setIsContextCollapsed(!isContextCollapsed)}
                  >
                    From “{queueContextLabel || 'Context'}” ({contextItems.length})
                    {contextItems.length > 8 && (
                      isContextCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />
                    )}
                  </span>
                </div>
                {displayedContextItems.map((item) => (
                  <ReadOnlyTrackRow
                    key={item.dndId}
                    track={item.track}
                    onPlay={() => playAtIndex(item.absoluteIndex)}
                    onRemove={() => removeAt(item.absoluteIndex)}
                    onContextMenu={(e) =>
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        track: item.track,
                        absoluteIndex: item.absoluteIndex,
                        origin: 'context',
                      })
                    }
                  />
                ))}
                {contextItems.length > 8 && isContextCollapsed && (
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 11, height: 26, margin: '4px 0' }}
                    onClick={() => setIsContextCollapsed(false)}
                  >
                    Show {contextItems.length - 8} more
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Divider (only when both queue and autoplay are shown) */}
      {hasUpcomingQueue && <div className="queue-split-divider" />}

      {/* 4. Autoplay Section (Bottom Half or Full remaining height when no upcoming queue) */}
      <div className="queue-split-bottom">
        <div className="queue-section-header-bar">
          <div className="queue-header-left">
            <Sparkle size={13} weight={autoPlayEnabled ? 'fill' : 'regular'} color="var(--accent)" />
            <span>Autoplay</span>
            {autoItems.length > 0 && (
              <span className="queue-header-badge">{autoItems.length}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className={`autoplay-toggle-pill ${autoPlayEnabled ? 'active' : ''}`}
              onClick={toggleAutoPlay}
              title={autoPlayEnabled ? 'Turn autoplay off' : 'Turn autoplay on'}
            >
              {autoPlayEnabled ? 'On' : 'Off'}
            </button>
            {autoPlayEnabled && (
              <button
                className="btn-icon"
                style={{ width: 22, height: 22 }}
                onClick={refreshAutoPlay}
              title="Refresh mix"
                disabled={autoPlayLoading}
              >
                <ArrowsClockwise size={12} className={autoPlayLoading ? 'spinning-icon' : ''} />
              </button>
            )}
          </div>
        </div>

        {autoPlaySeed && (
          <div className="autoplay-hero-seed">
            Similar to <strong>{autoPlaySeed}</strong>
          </div>
        )}

        <div className="queue-scroll-area hide-scrollbar">
          {/* Loading Skeleton */}
          {autoPlayLoading && autoItems.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="autoplay-skeleton-row shimmer-pulse" />
              ))}
            </div>
          )}

          {/* Error state */}
          {autoPlayError && autoItems.length === 0 && (
            <div className="empty-library-state" style={{ padding: '24px 14px' }}>
              <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{autoPlayError}</div>
              <button
                className="btn-secondary"
                style={{ fontSize: 11, height: 26 }}
                onClick={refreshAutoPlay}
              >
                <ArrowsClockwise size={12} />
                <span>Retry</span>
              </button>
            </div>
          )}

          {/* Empty state when disabled or no tracks */}
          {!autoPlayLoading && !autoPlayError && autoItems.length === 0 && (
            <div className="empty-library-state" style={{ padding: '30px 14px' }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)' }}>
                {!autoPlayEnabled ? 'Autoplay is turned off' : 'No recommendations available'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                {!autoPlayEnabled
                  ? 'Turn on Autoplay to automatically queue similar songs.'
                  : 'Play any track from Explore, Search, or Library to generate recommendations.'}
              </div>
              {!autoPlayEnabled && (
                <button
                  className="btn-primary"
                  style={{ fontSize: 11, height: 26, marginTop: 12 }}
                  onClick={toggleAutoPlay}
                >
                  Turn on Autoplay
                </button>
              )}
            </div>
          )}

          {/* Autoplay track list */}
          {autoItems.map((item, idx) => (
            <ReadOnlyTrackRow
              key={item.dndId}
              track={item.track}
              itemNumber={idx + 1}
              onPlay={() => playAtIndex(item.absoluteIndex)}
              onRemove={() => removeAt(item.absoluteIndex)}
              onAddToQueue={() => addToQueue(item.track)}
              onContextMenu={(e) =>
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  track: item.track,
                  absoluteIndex: item.absoluteIndex,
                  origin: 'auto',
                })
              }
            />
          ))}
        </div>
      </div>

      {/* Context Menu for Queue items */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          track={contextMenu.track}
          items={[
            {
              label: 'Play now',
              icon: <Play size={14} weight="fill" />,
              onClick: () => {
                playAtIndex(contextMenu.absoluteIndex);
              },
            },
            {
              label: 'Play next',
              icon: <Play size={14} />,
              onClick: () => {
                playNext(contextMenu.track);
              },
            },
            {
              label: 'Add to queue',
              icon: <Plus size={14} />,
              onClick: () => {
                addToQueue(contextMenu.track);
              },
            },
            { divider: true, label: '', onClick: () => {} },
            {
              label: contextMenu.origin === 'auto' ? 'Remove from Autoplay' : 'Remove from queue',
              icon: <X size={14} />,
              onClick: () => {
                removeAt(contextMenu.absoluteIndex);
              },
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
