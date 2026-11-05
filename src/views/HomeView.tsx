import { useLibraryStore, getArtworkUrl, Track } from '../store/library';
import { handleThumbnailError } from '../utils/thumbnail';
import { usePlayerStore } from '../store/player';
import { TrackRow } from '../components/TrackRow';
import { TagEditor } from '../components/TagEditor';
import { useMemo, useState } from 'react';
import { Play, Disc, ArrowLeft, Shuffle, Plus } from '@phosphor-icons/react';

const MediaCard = ({ track, onClick }: { track: Track; onClick: () => void }) => {
  const artUrl = getArtworkUrl(track.art_hash);
  const isYt = track.source === 'youtube'
    || (track.path != null && track.path.startsWith('yt:'))
    || (typeof track.id === 'string' && track.id.startsWith('yt_'));
  const ext = isYt
    ? null
    : (track.path && !track.path.startsWith('http') ? (track.path.split('.').pop()?.toUpperCase() || 'PCM') : null);
  const title = track.title || (isYt ? 'YouTube track' : track.path.split(/[\\/]/).pop() || 'Untitled');

  return (
    <button className="media-card" onClick={onClick} title={`Play ${title}`}>
      <div className="media-card-art">
        {artUrl ? (
          <img
            src={artUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={handleThumbnailError}
          />
        ) : (
          <Disc size={34} />
        )}
        <span className="media-card-play" aria-hidden="true">
          <Play size={14} weight="fill" />
        </span>
      </div>
      <div className="media-card-meta">
        <span className="media-card-title" title={title}>{title}</span>
        <span className="media-card-subtitle" title={track.artist || 'Unknown artist'}>
          {track.artist || 'Unknown artist'}
          {ext ? ` · ${ext}` : ''}
        </span>
      </div>
    </button>
  );
};

const ArtistCard = ({ artist, count, onClick }: { artist: string; count: number; onClick: () => void }) => (
  <button className="artist-card" onClick={onClick} title={`View ${artist}`}>
    <span className="artist-card-art">
      <span className="artist-card-initial">{artist.charAt(0).toUpperCase()}</span>
    </span>
    <span className="artist-card-name" title={artist}>{artist}</span>
    <span className="artist-card-meta">{count} {count === 1 ? 'song' : 'songs'}</span>
  </button>
);

export function HomeView({ onScanFolder }: { onScanFolder?: () => void } = {}) {
  const { tracks } = useLibraryStore();
  const playDiscover = usePlayerStore(s => s.playDiscover);
  const playContext = usePlayerStore(s => s.playContext);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);

  const { topArtists, recentlyPlayed, recentlyAdded, summary, greeting } = useMemo(() => {
    const artistCounts: Record<string, number> = {};
    const albumSet = new Set<string>();

    for (const t of tracks) {
      if (t.artist && t.artist.toLowerCase() !== 'unknown artist') {
        artistCounts[t.artist] = (artistCounts[t.artist] || 0) + 1;
      }
      if (t.album) {
        albumSet.add(t.album);
      }
    }

    const topArtists = Object.entries(artistCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([artist, count]) => ({ artist, count }));

    const recentlyPlayed = [...tracks]
      .filter(t => t.last_played)
      .sort((a, b) => (b.last_played || 0) - (a.last_played || 0))
      .slice(0, 10);

    const recentlyAdded = [...tracks]
      .filter(t => t.mtime)
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
      .filter(t => !recentlyPlayed.some(p => p.id === t.id))
      .slice(0, 10);

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    return {
      topArtists,
      recentlyPlayed,
      recentlyAdded,
      greeting,
      summary: {
        artists: Object.keys(artistCounts).length,
        albums: albumSet.size,
      },
    };
  }, [tracks]);

  if (tracks.length === 0) {
    return (
      <div className="view-container">
        <div className="empty-view">
          <div className="empty-view-icon">
            <Disc size={28} />
          </div>
          <h2 className="empty-view-title">Your library is empty</h2>
          <p className="empty-view-text">
            Add a folder of music to get started.
          </p>
          {onScanFolder && (
            <button className="btn-primary" onClick={onScanFolder}>
              <Plus size={14} weight="bold" />
              <span>Add music folder</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (selectedArtist) {
    const artistTracks = tracks.filter(t => t.artist === selectedArtist);
    return (
      <div className="view-container home-view" style={{ overflowY: 'auto' }}>
        <header className="page-header">
          <div className="page-header-text">
            <button className="back-link" onClick={() => setSelectedArtist(null)}>
              <ArrowLeft size={13} weight="bold" />
              <span>Back</span>
            </button>
            <h1 className="page-title">{selectedArtist}</h1>
            <p className="page-subtitle">
              {artistTracks.length} {artistTracks.length === 1 ? 'song' : 'songs'}
            </p>
          </div>
          <div className="page-header-actions">
            <button
              className="btn-primary"
              onClick={() => playContext(artistTracks, 0, { contextLabel: selectedArtist || 'Artist' })}
            >
              <Play size={13} weight="fill" />
              <span>Play all</span>
            </button>
          </div>
        </header>

        <div className="view-content track-list">
          {artistTracks.map((track, i) => (
            <TrackRow 
              key={track.id} 
              track={track} 
              index={i} 
              onPlay={() => playDiscover(track)} 
              onEdit={() => setEditingTrack(track)} 
            />
          ))}
        </div>

        {editingTrack && (
          <TagEditor
            track={editingTrack}
            onClose={() => setEditingTrack(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="view-container home-view" style={{ overflowY: 'auto' }}>
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">{greeting}</h1>
          <p className="page-subtitle">
            {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
            {summary.artists > 0 ? ` · ${summary.artists} ${summary.artists === 1 ? 'artist' : 'artists'}` : ''}
            {summary.albums > 0 ? ` · ${summary.albums} ${summary.albums === 1 ? 'album' : 'albums'}` : ''}
          </p>
        </div>
        <div className="page-header-actions">
          <button
            className="btn-secondary"
            onClick={() => {
              const shuffled = [...tracks].sort(() => 0.5 - Math.random());
              playContext(shuffled, 0, { contextLabel: 'Shuffle' });
            }}
          >
            <Shuffle size={13} weight="bold" />
            <span>Shuffle library</span>
          </button>
          {onScanFolder && (
            <button className="btn-secondary" onClick={onScanFolder} title="Add a music folder">
              <Plus size={13} weight="bold" />
              <span>Add folder</span>
            </button>
          )}
        </div>
      </header>

      <div className="home-sections">
        {recentlyPlayed.length > 0 && (
          <section className="home-section">
            <div className="section-heading">
              <h2>Recently played</h2>
              <span className="section-count">{recentlyPlayed.length}</span>
            </div>
            <div className="media-grid">
              {recentlyPlayed.map((track) => (
                <MediaCard
                  key={`recent-${track.id}`}
                  track={track}
                  onClick={() => playDiscover(track)}
                />
              ))}
            </div>
          </section>
        )}

        {recentlyAdded.length > 0 && (
          <section className="home-section">
            <div className="section-heading">
              <h2>Recently added</h2>
              <span className="section-count">{recentlyAdded.length}</span>
            </div>
            <div className="media-grid">
              {recentlyAdded.map((track) => (
                <MediaCard
                  key={`added-${track.id}`}
                  track={track}
                  onClick={() => playDiscover(track)}
                />
              ))}
            </div>
          </section>
        )}

        {topArtists.length > 0 && (
          <section className="home-section">
            <div className="section-heading">
              <h2>Your artists</h2>
            </div>
            <div className="artist-grid">
              {topArtists.map((a) => (
                <ArtistCard
                  key={a.artist}
                  artist={a.artist}
                  count={a.count}
                  onClick={() => setSelectedArtist(a.artist)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {editingTrack && (
        <TagEditor
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
        />
      )}
    </div>
  );
}
