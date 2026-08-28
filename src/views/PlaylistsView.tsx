import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ListPlus, Trash, Plus, Heart, Play, Shuffle } from '@phosphor-icons/react';
import { Track, useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { TrackRow } from '../components/TrackRow';

interface Playlist {
  id: number;
  name: string;
  created_at: number;
}

export function PlaylistsView() {
  const { tracks } = useLibraryStore();
  const { playContext } = usePlayerStore();
  
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  
  const [isCreating, setIsCreating] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const fetchPlaylists = async () => {
    try {
      const p: Playlist[] = await invoke('get_playlists');
      setPlaylists(p);
      if (!selectedPlaylist) {
        setSelectedPlaylist({ id: -1, name: 'Liked Songs', created_at: 0 });
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchPlaylists();
  }, []);

  useEffect(() => {
    if (selectedPlaylist) {
      loadPlaylistTracks(selectedPlaylist.id);
    }
  }, [selectedPlaylist, tracks]);

  const loadPlaylistTracks = async (id: number) => {
    if (id === -1) {
      setPlaylistTracks(tracks.filter(t => t.favorite));
      return;
    }
    try {
      const trackIds: number[] = await invoke('get_playlist_tracks', { playlistId: id });
      const mapped = trackIds.map(tid => tracks.find(t => t.id === tid)).filter(Boolean) as Track[];
      setPlaylistTracks(mapped);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    try {
      const p: Playlist = await invoke('create_playlist', { name: newPlaylistName.trim() });
      await fetchPlaylists();
      setSelectedPlaylist(p);
      setIsCreating(false);
      setNewPlaylistName('');
    } catch (e) {
      console.error(e);
    }
  };

  const handleRemoveTrack = async (trackId: number) => {
    if (!selectedPlaylist) return;
    try {
      await invoke('remove_from_playlist', { playlistId: selectedPlaylist.id, trackId });
      loadPlaylistTracks(selectedPlaylist.id);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'row', padding: 0 }}>
      {/* Playlists Sidebar */}
      <div style={{ width: '250px', borderRight: '1px solid var(--divider)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--text-primary)' }}>Playlists</h2>
          <button className="btn-icon" onClick={() => setIsCreating(!isCreating)}><Plus size={16} /></button>
        </div>

        {isCreating && (
          <div style={{ padding: '0 24px 16px 24px' }}>
            <form onSubmit={handleCreate} style={{ display: 'flex', gap: '8px' }}>
              <input
                autoFocus
                className="form-input"
                placeholder="Name..."
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                style={{ flex: 1, padding: '6px 12px' }}
              />
            </form>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
          <div
            onClick={() => setSelectedPlaylist({ id: -1, name: 'Liked Songs', created_at: 0 })}
            style={{
              padding: '12px',
              borderRadius: '6px',
              cursor: 'pointer',
              marginBottom: '16px',
              backgroundColor: selectedPlaylist?.id === -1 ? 'var(--surface-selected)' : 'transparent',
              color: selectedPlaylist?.id === -1 ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: selectedPlaylist?.id === -1 ? 600 : 500,
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}
          >
            <div style={{ width: 28, height: 28, borderRadius: 4, background: 'linear-gradient(135deg, #4f46e5, #ec4899)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Heart size={16} weight="fill" />
            </div>
            Liked Songs
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8, paddingLeft: 12 }}>
            Your Playlists
          </div>

          {playlists.map(p => (
            <div
              key={p.id}
              onClick={() => setSelectedPlaylist(p)}
              style={{
                padding: '12px',
                borderRadius: '6px',
                cursor: 'pointer',
                marginBottom: '4px',
                backgroundColor: selectedPlaylist?.id === p.id ? 'var(--surface-selected)' : 'transparent',
                color: selectedPlaylist?.id === p.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: selectedPlaylist?.id === p.id ? 600 : 500,
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}
            >
              <ListPlus size={18} />
              {p.name}
            </div>
          ))}
        </div>
      </div>

      {/* Playlist Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedPlaylist ? (
          <>
            <div style={{ padding: '32px', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '32px', color: 'var(--text-primary)' }}>{selectedPlaylist.name}</h1>
                <div style={{ color: 'var(--text-tertiary)', marginTop: '8px' }}>
                  {playlistTracks.length} tracks
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  className="btn-secondary" 
                  onClick={() => playlistTracks.length > 0 && playContext(playlistTracks, 0)}
                  style={{ padding: '8px 16px', gap: '8px', color: 'var(--text-primary)' }}
                >
                  <Play size={16} weight="fill" />
                  <span style={{ fontWeight: 600 }}>Play All</span>
                </button>
                <button 
                  className="btn-secondary" 
                  onClick={() => {
                    if (playlistTracks.length === 0) return;
                    const shuffled = [...playlistTracks].sort(() => 0.5 - Math.random());
                    playContext(shuffled, 0);
                  }}
                  style={{ padding: '8px 16px', gap: '8px', color: 'var(--text-primary)' }}
                >
                  <Shuffle size={16} weight="bold" />
                  <span style={{ fontWeight: 600 }}>Shuffle</span>
                </button>
              </div>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 32px 32px 32px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {playlistTracks.map((track, i) => (
                  <div key={`${track.id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <TrackRow track={track} index={i} onPlay={() => playContext(playlistTracks, i)} onEdit={() => {}} />
                    </div>
                    {selectedPlaylist.id !== -1 && (
                      <button 
                        className="btn-icon" 
                        onClick={() => handleRemoveTrack(track.id)}
                        title="Remove from playlist"
                      >
                        <Trash size={16} />
                      </button>
                    )}
                  </div>
                ))}
                {playlistTracks.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-tertiary)' }}>
                    This playlist is empty.
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
            Select or create a playlist
          </div>
        )}
      </div>
    </div>
  );
}
