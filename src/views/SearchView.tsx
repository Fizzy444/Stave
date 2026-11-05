import { useShallow } from 'zustand/react/shallow';
import { useState, useEffect, useRef } from 'react';
import { useSearchStore } from '../store/search';
import { usePlayerStore, prefetchTrackOnHover } from '../store/player';
import {
  ytItemToTrack,
  YTTrackItem
} from '../store/ytmusic';
import { useMetadataStore } from '../store/metadata';
import { getHighResThumbnail, handleThumbnailError } from '../utils/thumbnail';
import {
  Plus,
  Clock,
  Play,
  Pause,
  DownloadSimple,
  Check,
  Link,
  CircleNotch,
  MusicNote
} from '@phosphor-icons/react';
import { invoke } from '@tauri-apps/api/core';
import { ContextMenu, ContextMenuItem } from '../components/ContextMenu';

const formatDurationSecs = (secs: number) => {
  if (!secs || isNaN(secs)) return '--:--';
  const minutes = Math.floor(secs / 60);
  const remaining = Math.floor(secs % 60);
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
};

export function SearchView() {
  const { query } = useSearchStore();
  const { playDiscover, queue, currentIndex, isPlaying, addToQueue, playNext, pause, resume } = usePlayerStore(useShallow(s => ({
    playDiscover: s.playDiscover,
    queue: s.queue,
    currentIndex: s.currentIndex,
    isPlaying: s.isPlaying,
    addToQueue: s.addToQueue,
    playNext: s.playNext,
    pause: s.pause,
    resume: s.resume,
  })));

  const [ytFilter, setYtFilter] = useState<'all' | 'songs' | 'videos' | 'albums'>('all');

  const searchCache = useMetadataStore((s) => s.search);
  const fetchSearch = useMetadataStore((s) => s.fetchSearch);

  const normalizedFilter = ytFilter === 'all' ? '' : ytFilter;
  const searchKey = `${query.trim().toLowerCase()}|${normalizedFilter}`;
  const currentSearchCache = query.trim() ? searchCache[searchKey] : null;
  const ytResults = currentSearchCache?.data || [];
  const isYtSearching = Boolean(currentSearchCache?.loading && !currentSearchCache?.data);
  const ytError = currentSearchCache?.error || null;

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    ytItem: YTTrackItem;
    index: number;
  } | null>(null);

  // Download feedback set
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
  const cleanCurrentId = String(currentTrack?.path || currentTrack?.id || '').replace(/^(yt:|yt_)/, '');

  const ytSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (ytSearchTimeoutRef.current) {
      clearTimeout(ytSearchTimeoutRef.current);
    }

    if (!query.trim()) {
      return;
    }

    ytSearchTimeoutRef.current = setTimeout(() => {
      const filterParam = ytFilter === 'all' ? undefined : ytFilter;
      fetchSearch(query.trim(), filterParam);
    }, 200);

    return () => {
      if (ytSearchTimeoutRef.current) {
        clearTimeout(ytSearchTimeoutRef.current);
      }
    };
  }, [query, ytFilter, fetchSearch]);

  const handlePlayYtTrack = (item: YTTrackItem) => {
    const cleanId = item.id.replace(/^(yt:|yt_)/, '');
    if (cleanId === cleanCurrentId) {
      if (isPlaying) {
        pause();
      } else {
        resume();
      }
      return;
    }

    playDiscover(ytItemToTrack(item));
  };

  const handleDownloadYtTrack = async (item: YTTrackItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const cleanId = item.id.replace(/^(yt:|yt_)/, '');
    try {
      await invoke('queue_download', {
        id: cleanId,
        title: item.title,
        artist: item.artist
      });
      setDownloadedIds((prev) => new Set(prev).add(cleanId));
      setTimeout(() => {
        setDownloadedIds((prev) => {
          const next = new Set(prev);
          next.delete(cleanId);
          return next;
        });
      }, 3000);
    } catch (err) {
      console.error('Failed to queue download:', err);
    }
  };

  const getContextMenuItems = (): ContextMenuItem[] => {
    if (!contextMenu) return [];
    const { ytItem } = contextMenu;
    const cleanId = ytItem.id.replace(/^(yt:|yt_)/, '');
    const isCurrentPlaying = cleanId === cleanCurrentId && isPlaying;

    return [
      {
        label: isCurrentPlaying ? 'Pause' : 'Play',
        icon: isCurrentPlaying ? <Pause size={16} /> : <Play size={16} />,
        onClick: () => handlePlayYtTrack(ytItem)
      },
      {
        label: 'Play next',
        icon: <Play size={16} />,
        onClick: () => playNext(ytItemToTrack(ytItem))
      },
      {
        label: 'Add to queue',
        icon: <Plus size={16} />,
        onClick: () => addToQueue(ytItemToTrack(ytItem))
      },
      { divider: true, label: '', onClick: () => {} },
      {
        label: downloadedIds.has(cleanId) ? 'Download queued' : 'Download',
        icon: downloadedIds.has(cleanId) ? <Check size={16} /> : <DownloadSimple size={16} />,
        onClick: () => handleDownloadYtTrack(ytItem)
      },
      {
        label: 'Copy link',
        icon: <Link size={16} />,
        onClick: () => {
          navigator.clipboard?.writeText(`https://youtube.com/watch?v=${cleanId}`);
        }
      }
    ];
  };

  return (
    <div className="view-container search-view">
      <header className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">YouTube Music</p>
          <h1 className="page-title">{query.trim() ? 'Search results' : 'Search'}</h1>
          <p className="page-subtitle">
            {!query.trim()
              ? 'Use the search bar above to find songs.'
              : isYtSearching
              ? 'Searching…'
              : `${ytResults.length} ${ytResults.length === 1 ? 'result' : 'results'} for “${query}”`}
          </p>
        </div>
        <div className="page-header-actions">
          <div className="search-filter-chips">
            {(['all', 'songs', 'videos', 'albums'] as const).map((filter) => (
              <button
                key={filter}
                className={`search-filter-chip ${ytFilter === filter ? 'active' : ''}`}
                onClick={() => setYtFilter(filter)}
              >
                {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="view-content search-content">
        {isYtSearching && (
          <div className="inline-loading">
            <CircleNotch size={18} className="spinning-icon" />
            <span>Searching…</span>
          </div>
        )}

        {!isYtSearching && ytResults.length === 0 && query.trim() !== '' && (
          <div className="inline-empty">
            {ytError ? ytError : `No songs found for “${query}”. Try a different search.`}
          </div>
        )}

        {!isYtSearching && !query.trim() && (
          <div className="inline-empty">Start typing to search YouTube Music.</div>
        )}

        {!isYtSearching && ytResults.length > 0 && (
          <>
            <div className="search-table-header">
              <div className="search-col-index">#</div>
              <div className="search-col-title">Title</div>
              <div className="search-col-artist">Artist</div>
              <div className="search-col-actions">
                <Clock size={13} />
              </div>
            </div>

            <div className="search-results">
              {ytResults.map((item, i) => {
                const cleanId = item.id.replace(/^(yt:|yt_)/, '');
                const isCurrent = cleanId === cleanCurrentId;
                const isThisPlaying = isCurrent && isPlaying;
                const isDownloaded = downloadedIds.has(cleanId);
                const thumbUrl = getHighResThumbnail(item.thumbnail_url) || `https://i.ytimg.com/vi/${cleanId}/hq720.jpg`;

                return (
                  <div
                    key={item.id + i}
                    className={`search-row ${isCurrent ? 'is-active' : ''}`}
                    onClick={() => handlePlayYtTrack(item)}
                    onMouseEnter={() => prefetchTrackOnHover(ytItemToTrack(item))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        ytItem: item,
                        index: i
                      });
                    }}
                  >
                    <div className="search-col-index">
                      {isThisPlaying ? (
                        <Pause size={13} weight="fill" />
                      ) : isCurrent ? (
                        <Play size={13} weight="fill" />
                      ) : (
                        i + 1
                      )}
                    </div>

                    <div className="search-title-cell">
                      <div className="search-thumb">
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={handleThumbnailError}
                          />
                        ) : (
                          <MusicNote size={18} />
                        )}
                      </div>
                      <div className="search-title-text" title={item.title}>{item.title}</div>
                    </div>

                    <div className="search-col-artist" title={item.artist}>{item.artist}</div>

                    <div className="search-col-actions">
                      <button
                        className="btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          addToQueue(ytItemToTrack(item));
                        }}
                        title="Add to queue"
                      >
                        <Plus size={15} />
                      </button>

                      <button
                        className="btn-icon"
                        onClick={(e) => handleDownloadYtTrack(item, e)}
                        title={isDownloaded ? 'Queued for download' : 'Download'}
                      >
                        {isDownloaded ? <Check size={15} /> : <DownloadSimple size={15} />}
                      </button>

                      <span className="search-duration">
                        {formatDurationSecs(item.duration_secs)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={getContextMenuItems()}
        />
      )}
    </div>
  );
}
