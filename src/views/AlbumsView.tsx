import { useState, useMemo } from 'react';
import { useLibraryStore, Track, getArtworkUrl } from '../store/library';
import { usePlayerStore } from '../store/player';
import { Disc, Play, CaretLeft } from '@phosphor-icons/react';
import { handleThumbnailError } from '../utils/thumbnail';

export function AlbumsView() {
  const tracks = useLibraryStore(state => state.tracks);
  const playContext = usePlayerStore(state => state.playContext);
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string | null>(null);

  const albums = useMemo(() => {
    const map = new Map<string, { title: string; artist: string; art_hash: string | null; tracks: Track[] }>();
    for (const track of tracks) {
      const title = track.album || 'Unknown album';
      const artist = track.album_artist || track.artist || 'Unknown artist';
      const key = `${title}:::${artist}`;
      if (!map.has(key)) map.set(key, { title, artist, art_hash: track.art_hash, tracks: [] });
      const album = map.get(key)!;
      album.tracks.push(track);
      if (!album.art_hash && track.art_hash) album.art_hash = track.art_hash;
    }
    const result = Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
    result.forEach(album => album.tracks.sort((a, b) =>
      (a.disc_no || 1) - (b.disc_no || 1) || (a.track_no || 0) - (b.track_no || 0)
    ));
    return result;
  }, [tracks]);

  const album = selectedAlbumKey ? albums.find(item => `${item.title}:::${item.artist}` === selectedAlbumKey) : null;

  if (selectedAlbumKey && album) {
    return (
      <div className="view-container album-detail">
        <header className="album-detail-header">
          <div className="album-detail-art">
            {album.art_hash ? (
              <img
                src={getArtworkUrl(album.art_hash) || ''}
                alt=""
                decoding="async"
                onError={handleThumbnailError}
              />
            ) : (
              <Disc size={62} />
            )}
          </div>
          <div className="album-detail-info">
            <button onClick={() => setSelectedAlbumKey(null)} className="back-link album-detail-back">
              <CaretLeft size={12} weight="bold" />
              <span>Albums</span>
            </button>
            <div className="album-detail-eyebrow">Album</div>
            <h1 className="album-detail-title">{album.title}</h1>
            <div className="album-detail-meta">
              {album.artist} · {album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}
            </div>
            <div className="album-detail-actions">
              <button className="btn-primary" onClick={() => playContext(album.tracks, 0, { contextLabel: album.title })}>
                <Play size={13} weight="fill" />
                <span>Play</span>
              </button>
            </div>
          </div>
        </header>
        <div className="album-tracks">
          {album.tracks.map((track, index) => (
            <div key={track.id} className="album-track-row" onClick={() => playContext(album.tracks, index, { contextLabel: album.title })}>
              <div className="album-track-index">{track.track_no || index + 1}</div>
              <div className="album-track-main">
                <div className="album-track-title">{track.title || track.path.split(/[\\/]/).pop()}</div>
                <div className="album-track-artist">{track.artist || 'Unknown artist'}</div>
              </div>
              <div className="album-track-duration">
                {track.duration_ms ? `${Math.floor(track.duration_ms / 60000)}:${String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, '0')}` : '--:--'}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="view-container albums-view">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">Albums</h1>
          <p className="page-subtitle">
            {albums.length} {albums.length === 1 ? 'album' : 'albums'} in your library
          </p>
        </div>
      </header>
      <div className="albums-body">
        {albums.length === 0 ? (
          <div className="view-empty">
            <p>No albums yet. Add a folder of music to get started.</p>
          </div>
        ) : (
          <div className="albums-grid">
            {albums.map(item => {
              const key = `${item.title}:::${item.artist}`;
              return (
                <button key={key} className="album-card" onClick={() => setSelectedAlbumKey(key)}>
                  <div className="album-card-art">
                    {item.art_hash ? (
                      <img
                        src={getArtworkUrl(item.art_hash) || ''}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={handleThumbnailError}
                      />
                    ) : (
                      <Disc size={48} />
                    )}
                  </div>
                  <div className="album-card-info">
                    <div className="album-card-title">{item.title}</div>
                    <div className="album-card-artist">{item.artist}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
