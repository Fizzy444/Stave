import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DownloadSimple, MagnifyingGlass, Check, CaretDown, CaretRight } from '@phosphor-icons/react';

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
        next[i].status = 'searching';
        return next;
      });

      try {
        const query = `${matches[i].spotify.title} - ${matches[i].spotify.artist}`;
        const res = await invoke<YTSearchResult[]>('search_youtube', { query });
        
        setMatches(prev => {
          const next = [...prev];
          next[i].ytMatches = res;
          next[i].status = res.length > 0 ? 'matched' : 'failed';
          return next;
        });
      } catch (e) {
        setMatches(prev => {
          const next = [...prev];
          next[i].status = 'failed';
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
          next[i].status = 'queued';
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

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="view-header" style={{ flexShrink: 0, padding: '48px 32px 0 32px' }}>
        <h2 style={{ fontSize: '32px', fontWeight: 700, margin: 0, color: 'var(--text-primary)', letterSpacing: '-1px' }}>
          Spotify Import
        </h2>
        
        {!playlist && (
          <form onSubmit={handleFetch} style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '600px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Playlist URL or ID</label>
              <input 
                type="text" 
                className="search-input"
                style={{ width: '100%', height: '40px', borderRadius: '4px' }}
                value={playlistUrl} 
                onChange={e => setPlaylistUrl(e.target.value)} 
                placeholder="https://open.spotify.com/playlist/..." 
                required
              />
            </div>

            {error && <div style={{ color: '#f87171', fontSize: '13px' }}>{error}</div>}

            <button type="submit" disabled={isFetching} style={{
              background: 'var(--text-primary)', color: 'var(--bg-base)', padding: '12px 24px',
              border: 'none', borderRadius: '24px', fontWeight: 600, alignSelf: 'flex-start',
              cursor: 'pointer', marginTop: '8px'
            }}>
              {isFetching ? 'Fetching...' : 'Fetch Playlist'}
            </button>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px' }}>
              Only public playlists are supported.
            </div>
          </form>
        )}
      </div>

      {playlist && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '24px 32px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>{playlist.name}</div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{playlist.tracks.length} tracks</div>
            </div>
            <div style={{ display: 'flex', gap: '16px' }}>
              <button 
                onClick={findMatches}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)', color: 'var(--text-primary)', padding: '8px 16px',
                  border: 'none', borderRadius: '16px', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
                }}
              >
                <MagnifyingGlass size={16} /> Auto Match
              </button>
              <button 
                onClick={handleImport}
                style={{
                  background: 'var(--text-primary)', color: 'var(--bg-base)', padding: '8px 16px',
                  border: 'none', borderRadius: '16px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
                }}
              >
                <DownloadSimple size={16} weight="bold" /> Queue Selected
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 32px 32px 32px' }}>
            {matches.map((match, index) => {
              const selectedMatch = match.ytMatches[match.selectedIndex];
              return (
                <div key={index} style={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.03)', 
                  borderRadius: '8px', 
                  marginBottom: '8px',
                  border: '1px solid var(--divider)'
                }}>
                  <div 
                    style={{ padding: '16px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                    onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                  >
                    <div style={{ color: 'var(--text-tertiary)', marginRight: '16px' }}>
                      {expandedIndex === index ? <CaretDown size={16} /> : <CaretRight size={16} />}
                    </div>
                    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      {/* Spotify Side */}
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>SPOTIFY</div>
                        <div style={{ fontSize: '15px', color: 'var(--text-primary)', fontWeight: 500 }}>
                          {match.spotify.title}
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          {match.spotify.artist} • {formatDuration(match.spotify.duration_ms)}
                        </div>
                      </div>
                      
                      {/* YouTube Side */}
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>MATCH</div>
                        {match.status === 'pending' && <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>Waiting...</div>}
                        {match.status === 'searching' && <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Searching YouTube...</div>}
                        {match.status === 'failed' && <div style={{ fontSize: '13px', color: '#f87171' }}>No Match Found</div>}
                        {match.status === 'queued' && <div style={{ fontSize: '13px', color: '#4ade80', display: 'flex', alignItems: 'center', gap: '4px' }}><Check size={14} /> Added to Downloads</div>}
                        {match.status === 'matched' && selectedMatch && (
                          <div>
                            <div style={{ fontSize: '15px', color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {selectedMatch.title}
                            </div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                              {selectedMatch.artist} • {formatDuration(selectedMatch.duration * 1000)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {expandedIndex === index && match.ytMatches.length > 0 && (
                    <div style={{ padding: '16px', borderTop: '1px solid var(--divider)', backgroundColor: 'rgba(0, 0, 0, 0.2)' }}>
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>Alternative Matches</div>
                      {match.ytMatches.map((ytm, yi) => (
                        <div 
                          key={ytm.id} 
                          onClick={() => {
                            const next = [...matches];
                            next[index].selectedIndex = yi;
                            setMatches(next);
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', padding: '12px', borderRadius: '4px', cursor: 'pointer',
                            backgroundColor: yi === match.selectedIndex ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                            marginBottom: '4px'
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{ytm.title}</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{ytm.artist} • {formatDuration(ytm.duration * 1000)}</div>
                          </div>
                          {yi === match.selectedIndex && <Check size={16} color="var(--text-primary)" />}
                        </div>
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
  );
}
