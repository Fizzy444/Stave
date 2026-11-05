import { useShallow } from 'zustand/react/shallow';
import { useState, useEffect, useMemo } from 'react';
import {
  CaretLeft,
  Play,
  Pause,
  Plus,
  Shuffle,
  DownloadSimple,
  ArrowSquareOut,
  Disc,
  Clock,
  Check,
  MagnifyingGlass,
  CircleNotch,
  ListPlus,
  Link
} from '@phosphor-icons/react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  ytItemToTrack,
  YTTrackItem
} from '../store/ytmusic';
import { usePlayerStore, prefetchTrackOnHover } from '../store/player';
import { ContextMenu, ContextMenuItem } from '../components/ContextMenu';
import { useMetadataStore } from '../store/metadata';
import { getHighResThumbnail, handleThumbnailError } from '../utils/thumbnail';

interface OnlinePlaylistViewProps {
  initialPlaylistId?: string | null;
  onBack?: () => void;
}

export function parsePlaylistInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const url = new URL(trimmed);
      const listParam = url.searchParams.get('list');
      if (listParam) return listParam;
    }
  } catch {
    // Ignore URL parse error and treat as raw ID
  }
  return trimmed;
}

const formatDurationSecs = (secs: number) => {
  if (!secs || isNaN(secs)) return '--:--';
  const minutes = Math.floor(secs / 60);
  const remaining = Math.floor(secs % 60);
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
};

const formatTotalDuration = (secs: number) => {
  if (!secs || isNaN(secs)) return '';
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (hours > 0) {
    return `${hours} hr ${minutes} min`;
  }
  return `${minutes} min`;
};

export function OnlinePlaylistView({ initialPlaylistId, onBack }: OnlinePlaylistViewProps) {
  const [playlistId, setPlaylistId] = useState<string>(initialPlaylistId || '');
  const [inputUrl, setInputUrl] = useState<string>(initialPlaylistId || '');

  const playlistDetailsCache = useMetadataStore((s) => s.playlistDetails);
  const fetchPlaylistDetails = useMetadataStore((s) => s.fetchPlaylistDetails);

  const cleanCurrentId = parsePlaylistInput(playlistId);
  const currentCache = cleanCurrentId ? playlistDetailsCache[cleanCurrentId] : null;
  const playlist = currentCache?.data || null;
  const loading = Boolean(currentCache?.loading && !playlist);
  const error = currentCache?.error || null;

  // Download states
  const [downloadingAll, setDownloadingAll] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());

  // Context Menu
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    track: YTTrackItem;
    index: number;
  } | null>(null);

  const { queue, currentIndex, isPlaying, playContext, addToQueue, playNext, pause, resume } = usePlayerStore(useShallow(s => ({
    queue: s.queue,
    currentIndex: s.currentIndex,
    isPlaying: s.isPlaying,
    playContext: s.playContext,
    addToQueue: s.addToQueue,
    playNext: s.playNext,
    pause: s.pause,
    resume: s.resume,
  })));
  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  const loadPlaylist = async (id: string, force: boolean = false) => {
    const cleanId = parsePlaylistInput(id);
    if (!cleanId) return;
    setPlaylistId(cleanId);
    await fetchPlaylistDetails(cleanId, force);
  };

  useEffect(() => {
    if (initialPlaylistId) {
      setInputUrl(initialPlaylistId);
      loadPlaylist(initialPlaylistId);
    }
  }, [initialPlaylistId]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;
    loadPlaylist(inputUrl);
  };

  const isTrackActive = (id: string) => {
    if (!currentTrack) return false;
    const cleanId = id.replace(/^(yt:|yt_)/, '');
    const trackCleanId = String(currentTrack.path || currentTrack.id || '').replace(/^(yt:|yt_)/, '');
    return cleanId === trackCleanId;
  };

  const playlistTracks = useMemo(() => {
    if (!playlist?.tracks) return [];
    return playlist.tracks.map(ytItemToTrack);
  }, [playlist]);

  const totalDurationSecs = useMemo(() => {
    if (!playlist?.tracks) return 0;
    return playlist.tracks.reduce((acc, t) => acc + (t.duration_secs || 0), 0);
  }, [playlist]);

  const handlePlayAll = () => {
    if (playlistTracks.length === 0) return;
    playContext(playlistTracks, 0, { contextLabel: playlist?.title || 'Playlist' });
  };

  const handleShufflePlay = () => {
    if (playlistTracks.length === 0) return;
    const shuffled = [...playlistTracks].sort(() => Math.random() - 0.5);
    playContext(shuffled, 0, { contextLabel: playlist?.title || 'Playlist' });
  };

  const handleAddAllToQueue = () => {
    if (playlistTracks.length === 0) return;
    for (const track of playlistTracks) {
      addToQueue(track);
    }
  };

  const handlePlayTrack = (trackItem: YTTrackItem, index: number) => {
    const cleanId = trackItem.id.replace(/^(yt:|yt_)/, '');
    const currentCleanId = String(currentTrack?.path || currentTrack?.id || '').replace(/^(yt:|yt_)/, '');

    if (cleanId === currentCleanId) {
      if (isPlaying) {
        pause();
      } else {
        resume();
      }
      return;
    }

    playContext(playlistTracks, index, { contextLabel: playlist?.title || 'Playlist' });
  };

  const handleDownloadTrack = async (trackItem: YTTrackItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const cleanId = trackItem.id.replace(/^(yt:|yt_)/, '');
    try {
      await invoke('queue_download', {
        id: cleanId,
        title: trackItem.title,
        artist: trackItem.artist
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
      console.error('Failed to download track:', err);
    }
  };

  const handleDownloadAll = async () => {
    if (!playlist?.tracks || playlist.tracks.length === 0 || downloadingAll) return;
    setDownloadingAll(true);
    setDownloadProgress(0);

    let completed = 0;
    for (const track of playlist.tracks) {
      const cleanId = track.id.replace(/^(yt:|yt_)/, '');
      try {
        await invoke('queue_download', {
          id: cleanId,
          title: track.title,
          artist: track.artist
        });
        setDownloadedIds((prev) => new Set(prev).add(cleanId));
      } catch (err) {
        console.error('Failed to queue download for:', track.title, err);
      }
      completed++;
      setDownloadProgress(Math.round((completed / playlist.tracks.length) * 100));
    }

    setTimeout(() => {
      setDownloadingAll(false);
      setDownloadProgress(0);
    }, 1500);
  };

  const handleOpenInYouTube = async () => {
    if (!playlistId) return;
    const url = `https://music.youtube.com/playlist?list=${playlistId}`;
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  const getContextMenuItems = (): ContextMenuItem[] => {
    if (!contextMenu) return [];
    const { track, index } = contextMenu;
    const cleanId = track.id.replace(/^(yt:|yt_)/, '');
    const isActive = isTrackActive(track.id);

    return [
      {
        label: isActive && isPlaying ? 'Pause' : 'Play',
        icon: isActive && isPlaying ? <Pause size={16} /> : <Play size={16} />,
        onClick: () => handlePlayTrack(track, index)
      },
      {
        label: 'Play next',
        icon: <Play size={16} />,
        onClick: () => playNext(ytItemToTrack(track))
      },
      {
        label: 'Add to queue',
        icon: <Plus size={16} />,
        onClick: () => addToQueue(ytItemToTrack(track))
      },
      { divider: true, label: '', onClick: () => {} },
      {
        label: downloadedIds.has(cleanId) ? 'Queued' : 'Download',
        icon: downloadedIds.has(cleanId) ? <Check size={16} /> : <DownloadSimple size={16} />,
        onClick: () => handleDownloadTrack(track)
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
    <div className="view-container online-playlist-view">
      {/* 1. Top URL Navigation Bar */}
      <div className="online-playlist-top-bar">
        {onBack && (
          <button className="btn-icon" onClick={onBack} title="Go back">
            <CaretLeft size={20} weight="regular" />
          </button>
        )}

        <form className="online-playlist-url-form" onSubmit={handleFormSubmit}>
          <div className="online-playlist-input-wrapper">
            <MagnifyingGlass size={16} color="var(--text-tertiary)" />
            <input
              type="text"
              className="online-playlist-input"
              placeholder="Paste a YouTube playlist or album link"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn-primary online-playlist-load-btn"
            disabled={loading || !inputUrl.trim()}
          >
            {loading ? <CircleNotch size={15} className="spinning-icon" /> : 'Load'}
          </button>
        </form>
      </div>

      <div className="online-playlist-content hide-scrollbar">
        {/* Loading Skeleton */}
        {loading && (
          <div className="online-playlist-skeleton">
            <div className="skeleton-header-box shimmer-pulse" />
            <div className="skeleton-rows">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div key={i} className="skeleton-row shimmer-pulse" />
              ))}
            </div>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="online-playlist-empty-card">
            <Disc size={48} color="var(--text-tertiary)" />
            <h3>Couldn't load this playlist</h3>
            <p>{error}</p>
            <p className="online-playlist-hint">
              Check the link, or make sure the audio tools are installed for restricted playlists.
            </p>
          </div>
        )}

        {/* Initial Empty State (if no playlist loaded yet) */}
        {!loading && !error && !playlist && (
          <div className="online-playlist-empty-card">
            <Disc size={64} weight="thin" color="var(--accent)" />
            <h3>Open a playlist</h3>
            <p>
              Paste any public YouTube Music playlist or album link above to play it here
              and add it to your library.
            </p>
            <div className="online-playlist-suggestions">
              <span className="suggestion-label">Try one of these</span>
              <button
                className="btn-secondary suggestion-pill"
                onClick={() => {
                  setInputUrl('RDCLAK5uy_kfdmz5b-P8p90v3iO_4_3qM11k3Rk5b-A');
                  loadPlaylist('RDCLAK5uy_kfdmz5b-P8p90v3iO_4_3qM11k3Rk5b-A');
                }}
              >
                Today's Hits
              </button>
              <button
                className="btn-secondary suggestion-pill"
                onClick={() => {
                  setInputUrl('RDCLAK5uy_l4396aY80iF6tU5e1U39N2iY-9V5P-Q_k');
                  loadPlaylist('RDCLAK5uy_l4396aY80iF6tU5e1U39N2iY-9V5P-Q_k');
                }}
              >
                Top 100 Global
              </button>
            </div>
          </div>
        )}

        {/* Loaded Playlist View */}
        {!loading && !error && playlist && (
          <>
            {/* Playlist Ambient Hero Header */}
            <div className="online-playlist-header">
              {playlist.thumbnail_url && (
                <div
                  className="online-playlist-header-glow"
                  style={{
                    backgroundImage: `url(${getHighResThumbnail(playlist.thumbnail_url)})`
                  }}
                />
              )}

              <div className="online-playlist-cover-box">
                {playlist.thumbnail_url ? (
                  <img
                    src={getHighResThumbnail(playlist.thumbnail_url) || ''}
                    alt={playlist.title}
                    className="online-playlist-cover-img"
                    decoding="async"
                    onError={handleThumbnailError}
                  />
                ) : (
                  <div className="online-playlist-cover-fallback">
                    <Disc size={72} color="var(--text-tertiary)" />
                  </div>
                )}
              </div>

              <div className="online-playlist-details">
                <span className="online-playlist-tag">Playlist</span>
                <h1 className="online-playlist-title" title={playlist.title}>
                  {playlist.title}
                </h1>

                <div className="online-playlist-meta">
                  {playlist.author && (
                    <span className="online-playlist-author">{playlist.author}</span>
                  )}
                  {playlist.author && <span>•</span>}
                  <span>{playlist.tracks.length} songs</span>
                  {totalDurationSecs > 0 && (
                    <>
                      <span>•</span>
                      <span>{formatTotalDuration(totalDurationSecs)}</span>
                    </>
                  )}
                </div>

                {playlist.description && (
                  <p className="online-playlist-description" title={playlist.description}>
                    {playlist.description}
                  </p>
                )}

                {/* Playlist Action Bar */}
                <div className="online-playlist-actions">
                  <button
                    className="btn-primary online-playlist-play-btn"
                    onClick={handlePlayAll}
                    title="Play all"
                  >
                    <Play size={18} weight="regular" />
                    <span>Play all</span>
                  </button>

                  <button
                    className="btn-secondary"
                    onClick={handleShufflePlay}
                    title="Shuffle"
                  >
                    <Shuffle size={16} weight="regular" />
                    <span>Shuffle</span>
                  </button>

                  <button
                    className="btn-secondary"
                    onClick={handleAddAllToQueue}
                    title="Add all songs to the queue"
                  >
                    <ListPlus size={16} weight="regular" />
                    <span>Add to queue</span>
                  </button>

                  <button
                    className="btn-secondary"
                    onClick={handleDownloadAll}
                    disabled={downloadingAll}
                    title="Download all songs"
                  >
                    {downloadingAll ? (
                      <>
                        <CircleNotch size={16} className="spinning-icon" />
                        <span>{downloadProgress}%</span>
                      </>
                    ) : (
                      <>
                        <DownloadSimple size={16} weight="regular" />
                        <span>Download</span>
                      </>
                    )}
                  </button>

                  <button
                    className="btn-icon"
                    onClick={handleOpenInYouTube}
                    title="Open on YouTube Music"
                  >
                    <ArrowSquareOut size={18} />
                  </button>
                </div>
              </div>
            </div>

            {/* Track List Header */}
            <div className="online-playlist-table-header">
              <div style={{ textAlign: 'center' }}>#</div>
              <div>Title</div>
              <div>Artist</div>
              <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                <Clock size={14} />
              </div>
            </div>

            {/* Tracks List */}
            <div className="online-playlist-tracklist">
              {playlist.tracks.map((trackItem, idx) => {
                const isActive = isTrackActive(trackItem.id);
                const isThisPlaying = isActive && isPlaying;
                const cleanId = trackItem.id.replace(/^(yt:|yt_)/, '');
                const isDownloaded = downloadedIds.has(cleanId);

                return (
                  <div
                    key={trackItem.id + idx}
                    className={`library-row online-playlist-row ${isActive ? 'is-active' : ''}`}
                    onClick={() => handlePlayTrack(trackItem, idx)}
                    onMouseEnter={() => prefetchTrackOnHover(ytItemToTrack(trackItem))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        track: trackItem,
                        index: idx
                      });
                    }}
                  >
                    {/* Index / Play Button */}
                    <div className="track-index-box">
                      <span className="track-index-num">
                        {isThisPlaying ? '▶' : idx + 1}
                      </span>
                      <button
                        className="track-play-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayTrack(trackItem, idx);
                        }}
                        title={isThisPlaying ? 'Pause' : 'Play'}
                      >
                        {isThisPlaying ? (
                          <Pause size={13} weight="regular" />
                        ) : (
                          <Play size={13} weight="regular" />
                        )}
                      </button>
                    </div>

                    {/* Title & Cover Thumbnail */}
                    <div className="track-title-block">
                      <div className="track-thumb">
                        {trackItem.thumbnail_url ? (
                          <img
                            src={getHighResThumbnail(trackItem.thumbnail_url) || ''}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={handleThumbnailError}
                          />
                        ) : (
                          <Disc size={16} />
                        )}
                      </div>
                      <div className="track-title-text" title={trackItem.title}>
                        {trackItem.title}
                      </div>
                    </div>

                    {/* Artist */}
                    <div className="track-artist-text" title={trackItem.artist}>
                      {trackItem.artist || 'Unknown artist'}
                    </div>

                    {/* Quick Action Buttons & Duration */}
                    <div className="online-playlist-actions-cell">
                      <button
                        className="btn-icon"
                        style={{ width: 28, height: 28 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          addToQueue(ytItemToTrack(trackItem));
                        }}
                        title="Add to queue"
                      >
                        <Plus size={14} />
                      </button>

                      <button
                        className="btn-icon"
                        style={{ width: 28, height: 28 }}
                        onClick={(e) => handleDownloadTrack(trackItem, e)}
                        title={isDownloaded ? 'Queued' : 'Download'}
                      >
                        {isDownloaded ? (
                          <Check size={14} color="var(--accent)" />
                        ) : (
                          <DownloadSimple size={14} />
                        )}
                      </button>

                      <span className="online-track-duration">
                        {formatDurationSecs(trackItem.duration_secs)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Context Menu */}
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
