import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ListPlus,
  Trash,
  Plus,
  Heart,
  Play,
  Shuffle,
  YoutubeLogo,
  ArrowsClockwise,
  ArrowSquareOut
} from '@phosphor-icons/react';
import { Track, useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { useYTAuthStore } from '../store/ytauth';
import {
  ytItemToTrack,
  YTLibraryPlaylist
} from '../store/ytmusic';
import { useMetadataStore } from '../store/metadata';
import { TrackRow } from '../components/TrackRow';
import { getHighResThumbnail, handleThumbnailError } from '../utils/thumbnail';

interface Playlist {
  id: number;
  name: string;
  created_at: number;
}

export type ActivePlaylistSelection =
  | { kind: 'local'; playlist: Playlist }
  | { kind: 'yt'; playlist: YTLibraryPlaylist };

interface PlaylistsViewProps {
  onOpenOnlinePlaylist?: (playlistId: string) => void;
}

export function PlaylistsView({ onOpenOnlinePlaylist }: PlaylistsViewProps = {}) {
  const { tracks } = useLibraryStore();
  const playContext = usePlayerStore(s => s.playContext);
  const account = useYTAuthStore((state) => state.account);
  const openAccountModal = useYTAuthStore((state) => state.openModal);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selected, setSelected] = useState<ActivePlaylistSelection>({
    kind: 'local',
    playlist: { id: -1, name: 'Liked Songs', created_at: 0 },
  });
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);

  // Metadata store for YouTube playlists and details
  const accountPlaylistsCache = useMetadataStore((s) => s.playlists);
  const fetchAccountPlaylists = useMetadataStore((s) => s.fetchAccountPlaylists);
  const playlistDetailsCache = useMetadataStore((s) => s.playlistDetails);
  const fetchPlaylistDetails = useMetadataStore((s) => s.fetchPlaylistDetails);

  const ytPlaylists = accountPlaylistsCache.data || [];
  const ytPlaylistsLoading = Boolean(accountPlaylistsCache.loading && !accountPlaylistsCache.data);

  // YouTube playlist details when a YT playlist is active
  const currentYtCache = selected.kind === 'yt' ? playlistDetailsCache[selected.playlist.playlist_id] : null;
  const ytDetails = currentYtCache?.data || null;
  const isYtLoading = Boolean(selected.kind === 'yt' && currentYtCache?.loading && !ytDetails);
  const ytError = selected.kind === 'yt' ? currentYtCache?.error : null;

  const [isCreating, setIsCreating] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const fetchPlaylists = async () => {
    try {
      const p: Playlist[] = await invoke('get_playlists');
      setPlaylists(p);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchPlaylists();
  }, []);

  // Load YouTube account playlists for the sidebar rail
  useEffect(() => {
    if (!account?.is_authenticated) return;
    fetchAccountPlaylists();
  }, [account?.is_authenticated, account?.channel_id, account?.name, fetchAccountPlaylists]);

  // Keep playlistTracks in sync with ytDetails when a YouTube playlist is selected
  useEffect(() => {
    if (selected.kind === 'yt') {
      if (ytDetails) {
        setPlaylistTracks(ytDetails.tracks.map(ytItemToTrack));
      } else {
        setPlaylistTracks([]);
      }
    }
  }, [selected.kind, ytDetails]);

  // Load tracks when selected playlist changes
  useEffect(() => {
    let cancelled = false;

    if (selected.kind === 'local') {
      if (selected.playlist.id === -1) {
        setPlaylistTracks(tracks.filter((t) => t.favorite));
      } else {
        invoke<number[]>('get_playlist_tracks', { playlistId: selected.playlist.id })
          .then((trackIds) => {
            if (cancelled) return;
            const mapped = trackIds
              .map((tid) => tracks.find((t) => t.id === tid))
              .filter(Boolean) as Track[];
            setPlaylistTracks(mapped);
          })
          .catch((e) => {
            if (!cancelled) console.error(e);
          });
      }
    } else {
      // Selected a YouTube playlist
      fetchPlaylistDetails(selected.playlist.playlist_id);
    }

    return () => {
      cancelled = true;
    };
  }, [selected, tracks, fetchPlaylistDetails]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    try {
      const p: Playlist = await invoke('create_playlist', { name: newPlaylistName.trim() });
      await fetchPlaylists();
      setSelected({ kind: 'local', playlist: p });
      setIsCreating(false);
      setNewPlaylistName('');
    } catch (e) {
      console.error(e);
    }
  };

  const handleRemoveTrack = async (trackId: number | string) => {
    if (selected.kind !== 'local' || selected.playlist.id === -1) return;
    try {
      await invoke('remove_from_playlist', { playlistId: selected.playlist.id, trackId });
      const trackIds: number[] = await invoke('get_playlist_tracks', {
        playlistId: selected.playlist.id,
      });
      const mapped = trackIds
        .map((tid) => tracks.find((t) => t.id === tid))
        .filter(Boolean) as Track[];
      setPlaylistTracks(mapped);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeletePlaylist = async () => {
    if (selected.kind !== 'local' || selected.playlist.id === -1) return;
    if (!window.confirm(`Delete playlist "${selected.playlist.name}"?`)) return;
    try {
      await invoke('delete_playlist', { playlistId: selected.playlist.id });
      await fetchPlaylists();
      setSelected({ kind: 'local', playlist: { id: -1, name: 'Liked Songs', created_at: 0 } });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="playlists-layout">
      {/* Playlists Sidebar */}
      <div className="playlists-rail">
        <div className="playlists-rail-header">
          <h2 className="playlists-rail-title">Playlists</h2>
          <button className="btn-icon" onClick={() => setIsCreating(!isCreating)} title="Create playlist">
            <Plus size={15} />
          </button>
        </div>

        {isCreating && (
          <div className="playlists-create">
            <form onSubmit={handleCreate}>
              <input
                autoFocus
                className="form-input"
                placeholder="Playlist name…"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
              />
            </form>
          </div>
        )}

        <div className="playlists-rail-scroll">
          {/* Liked Songs */}
          <button
            className={`playlist-rail-item ${selected.kind === 'local' && selected.playlist.id === -1 ? 'active' : ''}`}
            onClick={() => setSelected({ kind: 'local', playlist: { id: -1, name: 'Liked Songs', created_at: 0 } })}
          >
            <span className="playlist-rail-icon liked">
              <Heart size={14} weight="fill" />
            </span>
            <span className="playlist-rail-name">Liked Songs</span>
          </button>

          {/* Local Playlists */}
          {playlists.length > 0 && (
            <div className="playlists-rail-group-label">
              <span>Your playlists</span>
            </div>
          )}

          {playlists.map((p) => (
            <button
              key={p.id}
              className={`playlist-rail-item ${selected.kind === 'local' && selected.playlist.id === p.id ? 'active' : ''}`}
              onClick={() => setSelected({ kind: 'local', playlist: p })}
            >
              <span className="playlist-rail-icon">
                <ListPlus size={14} />
              </span>
              <span className="playlist-rail-name">{p.name}</span>
            </button>
          ))}

          {/* YouTube Music Playlists Section */}
          <div className="playlists-rail-group-label" style={{ marginTop: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <YoutubeLogo size={13} weight="fill" color="#ef4444" />
              YouTube Music
            </span>
            {account?.is_authenticated && ytPlaylistsLoading && (
              <span className="playlists-rail-group-meta">Loading…</span>
            )}
          </div>

          {account?.is_authenticated ? (
            <>
              <div className="yt-account-row">
                {account.avatar_url ? (
                  <img
                    className="yt-account-avatar"
                    src={getHighResThumbnail(account.avatar_url) || account.avatar_url}
                    alt=""
                    onError={handleThumbnailError}
                  />
                ) : (
                  <div className="yt-account-avatar-fallback">
                    {(account.name || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="yt-account-info">
                  <div className="yt-account-name">
                    {account.name || 'YouTube Music'}
                  </div>
                  {account.channel_title && (
                    <div className="yt-account-handle">
                      {account.channel_title}
                    </div>
                  )}
                </div>
              </div>

              {ytPlaylists.map((pl) => {
                const isActive = selected.kind === 'yt' && selected.playlist.playlist_id === pl.playlist_id;
                return (
                  <button
                    key={pl.playlist_id}
                    className={`yt-rail-item ${isActive ? 'active' : ''}`}
                    onClick={() => setSelected({ kind: 'yt', playlist: pl })}
                    title={pl.title}
                  >
                    <span className="yt-rail-thumb">
                      {pl.thumbnail_url ? (
                        <img
                          src={getHighResThumbnail(pl.thumbnail_url) || ''}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onError={handleThumbnailError}
                        />
                      ) : (
                        <YoutubeLogo size={14} />
                      )}
                    </span>
                    <span className="yt-rail-title">{pl.title}</span>
                  </button>
                );
              })}

              {!ytPlaylistsLoading && ytPlaylists.length === 0 && (
                <div className="yt-rail-empty">
                  No YouTube Music playlists found.
                </div>
              )}
            </>
          ) : (
            <button
              className="yt-connect-btn"
              onClick={openAccountModal}
            >
              Connect YouTube Music to see your playlists
            </button>
          )}
        </div>
      </div>

      {/* Playlist Content (Right Pane) */}
      <div className="playlist-main">
        {selected.kind === 'local' ? (
          <>
            <div className="playlist-hero">
              <div className={`playlist-hero-art ${selected.playlist.id === -1 ? 'liked' : ''}`}>
                {selected.playlist.id === -1 ? (
                  <Heart size={44} weight="fill" />
                ) : (
                  <ListPlus size={44} />
                )}
              </div>
              <div className="playlist-hero-info">
                <div className="playlist-hero-eyebrow">Playlist</div>
                <h1 className="playlist-hero-title">{selected.playlist.name}</h1>
                <div className="playlist-hero-meta">{playlistTracks.length} songs</div>
                <div className="playlist-hero-actions">
                  <button
                    className="playlist-hero-play"
                    onClick={() => playlistTracks.length > 0 && playContext(playlistTracks, 0, { contextLabel: selected.playlist.name })}
                    disabled={playlistTracks.length === 0}
                  >
                    <Play size={14} weight="fill" />
                    <span>Play</span>
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      if (playlistTracks.length === 0) return;
                      playContext([...playlistTracks].sort(() => 0.5 - Math.random()), 0, { contextLabel: selected.playlist.name });
                    }}
                    disabled={playlistTracks.length === 0}
                  >
                    <Shuffle size={13} weight="bold" />
                    <span>Shuffle</span>
                  </button>
                  {selected.playlist.id !== -1 && (
                    <button
                      className="btn-icon"
                      onClick={handleDeletePlaylist}
                      title="Delete playlist"
                      style={{ marginLeft: 'auto', width: 32, height: 32 }}
                    >
                      <Trash size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="playlist-tracks">
              <div className="playlist-tracklist">
                {playlistTracks.map((track, i) => (
                  <div key={`${track.id}-${i}`} className="playlist-track-wrap">
                    <TrackRow
                      track={track}
                      index={i}
                      onPlay={() => playContext(playlistTracks, i, { contextLabel: selected.playlist.name })}
                      onEdit={() => {}}
                    />
                    {selected.playlist.id !== -1 && (
                      <button
                        className="btn-icon playlist-remove-btn"
                        onClick={() => handleRemoveTrack(track.id)}
                        title="Remove from playlist"
                      >
                        <Trash size={15} />
                      </button>
                    )}
                  </div>
                ))}
                {playlistTracks.length === 0 && (
                  <div className="playlist-empty">No songs in this playlist yet.</div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* YouTube Playlist in right pane */
          <>
            <div className="playlist-hero">
              <div className="playlist-hero-art">
                {ytDetails?.thumbnail_url || selected.playlist.thumbnail_url ? (
                  <img
                    className="playlist-hero-cover-img"
                    src={getHighResThumbnail(ytDetails?.thumbnail_url || selected.playlist.thumbnail_url) || ''}
                    alt=""
                    decoding="async"
                    onError={handleThumbnailError}
                  />
                ) : (
                  <YoutubeLogo size={44} weight="fill" color="#ef4444" />
                )}
              </div>
              <div className="playlist-hero-info">
                <div className="playlist-hero-eyebrow">
                  <YoutubeLogo size={12} weight="fill" color="#ef4444" style={{ marginRight: 4, verticalAlign: -1 }} />
                  YouTube Music
                </div>
                <h1 className="playlist-hero-title">{ytDetails?.title || selected.playlist.title}</h1>
                <div className="playlist-hero-meta">
                  {ytDetails?.author && <span>{ytDetails.author} • </span>}
                  <span>{isYtLoading ? 'Loading tracks…' : `${playlistTracks.length} songs`}</span>
                </div>
                <div className="playlist-hero-actions">
                  <button
                    className="playlist-hero-play"
                    onClick={() => playlistTracks.length > 0 && playContext(playlistTracks, 0, { contextLabel: ytDetails?.title || selected.playlist.title })}
                    disabled={playlistTracks.length === 0}
                  >
                    <Play size={14} weight="fill" />
                    <span>Play</span>
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      if (playlistTracks.length === 0) return;
                      playContext([...playlistTracks].sort(() => 0.5 - Math.random()), 0, { contextLabel: ytDetails?.title || selected.playlist.title });
                    }}
                    disabled={playlistTracks.length === 0}
                  >
                    <Shuffle size={13} weight="bold" />
                    <span>Shuffle</span>
                  </button>
                  {onOpenOnlinePlaylist && (
                    <button
                      className="btn-secondary"
                      onClick={() => onOpenOnlinePlaylist(selected.playlist.playlist_id)}
                      title="View playlist page"
                      style={{ marginLeft: 'auto', gap: 4 }}
                    >
                      <ArrowSquareOut size={13} />
                      <span>View playlist</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="playlist-tracks">
              {isYtLoading ? (
                <div className="playlist-loading-skeleton" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' }}>
                  {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                    <div
                      key={i}
                      className="shimmer-pulse"
                      style={{
                        height: 40,
                        background: 'var(--surface-element)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    />
                  ))}
                </div>
              ) : ytError ? (
                <div className="playlist-empty" style={{ color: '#ef4444', flexDirection: 'column', gap: 8 }}>
                  <span>{ytError}</span>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      if (selected.kind === 'yt') {
                        fetchPlaylistDetails(selected.playlist.playlist_id, true);
                      }
                    }}
                    style={{ fontSize: 11 }}
                  >
                    <ArrowsClockwise size={13} /> Retry
                  </button>
                </div>
              ) : playlistTracks.length === 0 ? (
                <div className="playlist-empty">No songs in this YouTube Music playlist.</div>
              ) : (
                <div className="playlist-tracklist">
                  {playlistTracks.map((track, i) => (
                    <div key={`${track.id}-${i}`} className="playlist-track-wrap">
                      <TrackRow
                        track={track}
                        index={i}
                        onPlay={() => playContext(playlistTracks, i, { contextLabel: ytDetails?.title || selected.playlist.title })}
                        onEdit={() => {}}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
