import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DownloadSimple, MagnifyingGlass, Check, CaretDown, CaretRight, SpotifyLogo, CircleNotch } from '@phosphor-icons/react';

interface SpotifyTrack {
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
}

interface SpotifyPlaylist {
  name: string;
  tracks: SpotifyTrack[];
}

interface YTSearchResult {
  id: string;
  title: string;
  artist: string;
  duration: number;
}

interface MatchState {
  spotify: SpotifyTrack;
  ytMatches: YTSearchResult[];
  selectedIndex: number;
  status: 'pending' | 'searching' | 'matched' | 'failed' | 'queued';
}

export function SpotifyImportView() {
  const [playlistUrl, setPlaylistUrl] = useState('');

  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState('');
  const [playlist, setPlaylist] = useState<SpotifyPlaylist | null>(null);

  const [matches, setMatches] = useState<MatchState[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const extractPlaylistId = (url: string) => {
    // e.g. https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...
    const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
    return match ? match[1] : url; // fallback to raw string
  };

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playlistUrl) return;

    setIsFetching(true);
    setError('');
    try {
      const pid = extractPlaylistId(playlistUrl);
      const res = await invoke<SpotifyPlaylist>('fetch_spotify_playlist', {
        playlistId: pid
      });
      setPlaylist(res);
      setMatches(res.tracks.map(t => ({
        spotify: t,
        ytMatches: [],
        selectedIndex: 0,
        status: 'pending'
      })));
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setIsFetching(false);
    }
  };

  const findMatches = async () => {
    for (let i = 0; i < matches.length; i++) {
      if (matches[i].status === 'matched' || matches[i].status === 'queued') continue;

      setMatches(prev => {
        const next = [...prev];
        next[i] = { ...next[i], status: 'searching' };
        return next;
      });

      try {
        const query = `${matches[i].spotify.title} - ${matches[i].spotify.artist}`;
        const res = await invoke<YTSearchResult[]>('search_youtube', { query });

        setMatches(prev => {
          const next = [...prev];
          next[i] = {
            ...next[i],
            ytMatches: res,
            status: res.length > 0 ? 'matched' : 'failed'
          };
          return next;
        });
      } catch (e) {
        setMatches(prev => {
          const next = [...prev];
          next[i] = { ...next[i], status: 'failed' };
          return next;
        });
      }
    }
  };

  const handleImport = async () => {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (match.status !== 'matched') continue;

      const selected = match.ytMatches[match.selectedIndex];
      if (!selected) continue;

      try {
        await invoke('queue_download', {
          id: selected.id,
          title: match.spotify.title,
          artist: match.spotify.artist
        });

        setMatches(prev => {
          const next = [...prev];
          next[i] = { ...next[i], status: 'queued' };
          return next;
        });
      } catch (e) {
        console.error('Failed to queue', e);
      }
    }
  };

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  };

  const readyCount = matches.filter(m => m.status === 'matched').length;

  return (
    <div className="view-container spotify-view">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">Import from Spotify</h1>
          <p className="page-subtitle">
            Bring a Spotify playlist into your library as downloads.
          </p>
        </div>
      </header>

      <div className="view-content spotify-body">
        {!playlist ? (
          <div className="spotify-import-card">
            <div className="spotify-import-heading">
              <SpotifyLogo size={20} weight="fill" color="#1db954" />
              <span>Import a playlist</span>
            </div>
            <form onSubmit={handleFetch} className="spotify-import-form">
              <label className="spotify-import-label" htmlFor="spotify-playlist-url">
                Playlist link
              </label>
              <div className="spotify-import-row">
                <input
                  id="spotify-playlist-url"
                  type="text"
                  className="form-input"
                  value={playlistUrl}
                  onChange={e => setPlaylistUrl(e.target.value)}
                  placeholder="https://open.spotify.com/playlist/…"
                  required
                />
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isFetching}
                >
                  {isFetching ? (
                    <>
                      <CircleNotch size={14} className="spinning-icon" />
                      <span>Reading playlist…</span>
                    </>
                  ) : (
                    <span>Open playlist</span>
                  )}
                </button>
              </div>
              {error && <div className="spotify-error">{error}</div>}
              <p className="spotify-hint">
                Public playlists only. Stave matches each song to YouTube Music before downloading.
              </p>
            </form>
          </div>
        ) : (
          <div className="spotify-playlist">
            <div className="spotify-playlist-bar">
              <div className="spotify-playlist-heading">
                <div className="spotify-playlist-title">{playlist.name}</div>
                <div className="spotify-playlist-meta">
                  {playlist.tracks.length} {playlist.tracks.length === 1 ? 'song' : 'songs'}
                  {readyCount > 0 ? ` · ${readyCount} matched` : ''}
                </div>
              </div>
              <div className="spotify-playlist-actions">
                <button onClick={findMatches} className="btn-secondary">
                  <MagnifyingGlass size={14} />
                  <span>Find matches</span>
                </button>
                <button onClick={handleImport} className="btn-primary">
                  <DownloadSimple size={14} weight="bold" />
                  <span>Download matches</span>
                </button>
              </div>
            </div>

            <div className="spotify-match-list">
              {matches.map((match, index) => {
                const selectedMatch = match.ytMatches[match.selectedIndex];
                return (
                  <div key={index} className="spotify-match-card">
                    <div
                      className="spotify-match-row"
                      onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                    >
                      <div className="spotify-match-caret">
                        {expandedIndex === index ? <CaretDown size={14} /> : <CaretRight size={14} />}
                      </div>
                      <div className="spotify-match-grid">
                        <div className="spotify-match-col">
                          <div className="spotify-match-label">Spotify</div>
                          <div className="spotify-match-title">{match.spotify.title}</div>
                          <div className="spotify-match-meta">
                            {match.spotify.artist} · {formatDuration(match.spotify.duration_ms)}
                          </div>
                        </div>

                        <div className="spotify-match-col">
                          <div className="spotify-match-label">Match</div>
                          {match.status === 'pending' && (
                            <div className="spotify-match-status">Waiting</div>
                          )}
                          {match.status === 'searching' && (
                            <div className="spotify-match-status">
                              <CircleNotch size={12} className="spinning-icon" /> Searching…
                            </div>
                          )}
                          {match.status === 'failed' && (
                            <div className="spotify-match-status is-error">No match found</div>
                          )}
                          {match.status === 'queued' && (
                            <div className="spotify-match-status is-success">
                              <Check size={13} /> Added to downloads
                            </div>
                          )}
                          {match.status === 'matched' && selectedMatch && (
                            <>
                              <div className="spotify-match-title" title={selectedMatch.title}>
                                {selectedMatch.title}
                              </div>
                              <div className="spotify-match-meta">
                                {selectedMatch.artist} · {formatDuration(selectedMatch.duration * 1000)}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {expandedIndex === index && match.ytMatches.length > 0 && (
                      <div className="spotify-alternatives">
                        <div className="spotify-alternatives-label">Alternative matches</div>
                        {match.ytMatches.map((ytm, yi) => (
                          <button
                            key={ytm.id}
                            className={`spotify-alt-row ${yi === match.selectedIndex ? 'is-selected' : ''}`}
                            onClick={() => {
                              setMatches(prev => {
                                const next = [...prev];
                                next[index] = { ...next[index], selectedIndex: yi };
                                return next;
                              });
                            }}
                          >
                            <div className="spotify-alt-info">
                              <div className="spotify-alt-title" title={ytm.title}>{ytm.title}</div>
                              <div className="spotify-alt-meta">
                                {ytm.artist} · {formatDuration(ytm.duration * 1000)}
                              </div>
                            </div>
                            {yi === match.selectedIndex && <Check size={15} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
