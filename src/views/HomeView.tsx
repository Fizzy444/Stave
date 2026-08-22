import { useLibraryStore, getArtworkUrl, Track } from '../store/library';
import { usePlayerStore } from '../store/player';
import { TrackRow } from '../components/TrackRow';
import { TagEditor } from '../components/TagEditor';
import { useMemo, useState, useEffect } from 'react';

const CACHE_KEY = 'stave_artist_images_v4';
let artistImageCache: Record<string, string> = {};
try {
  artistImageCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
} catch (e) { }

const fetchArtistImage = async (artistName: string) => {
  if (artistImageCache[artistName]) return artistImageCache[artistName];
  try {
    // Step 1: Find the actual artist ID
    const searchRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&entity=musicArtist&limit=1`);
    const searchData = await searchRes.json();
    
    if (searchData.results && searchData.results.length > 0) {
      const artistId = searchData.results[0].artistId;
      
      // Step 2: Lookup an album explicitly by that exact artist ID
      const lookupRes = await fetch(`https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=1`);
      const lookupData = await lookupRes.json();
      
      // The first result is the artist, the second result is the album
      const albumResult = lookupData.results.find((r: any) => r.wrapperType === 'collection');
      
      if (albumResult && albumResult.artworkUrl100) {
        const url = albumResult.artworkUrl100.replace('100x100bb', '600x600bb');
        artistImageCache[artistName] = url;
        localStorage.setItem(CACHE_KEY, JSON.stringify(artistImageCache));
        return url;
      }
    }
  } catch (e) {
    console.error("Failed to fetch artist image:", e);
  }
  return null;
};

const ArtistCard = ({ artist, count, onClick }: { artist: string; count: number; onClick: () => void }) => {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    let active = true;
    fetchArtistImage(artist).then(url => {
      if (active && url) setImgUrl(url);
    });
    return () => { active = false; };
  }, [artist]);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: 'pointer',
        gap: '12px'
      }}
    >
      <div style={{ 
        width: '100%', 
        aspectRatio: '1/1', 
        borderRadius: '50%', 
        overflow: 'hidden', 
        backgroundColor: 'oklch(0.2 0 0)',
        boxShadow: isHovered ? '0 12px 24px rgba(0,0,0,0.4)' : '0 4px 12px rgba(0,0,0,0.2)',
        transition: 'all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'
      }}>
        {imgUrl ? (
          <img src={imgUrl} alt={artist} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: '24px' }}>♪</div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', width: '100%' }}>
        <div style={{ 
          fontWeight: 600, 
          fontSize: '14px', 
          color: 'var(--text-primary)', 
          textAlign: 'center', 
          width: '100%', 
          whiteSpace: 'nowrap', 
          overflow: 'hidden', 
          textOverflow: 'ellipsis' 
        }}>
          {artist}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 500 }}>
          {count} {count === 1 ? 'song' : 'songs'}
        </div>
      </div>
    </div>
  );
};

const TrackCard = ({ track, onClick }: { track: Track; onClick: () => void }) => {
  const artUrl = getArtworkUrl(track.art_hash);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        gap: '10px'
      }}
    >
      <div style={{ 
        width: '100%', 
        aspectRatio: '1/1', 
        borderRadius: '10px', 
        overflow: 'hidden', 
        backgroundColor: 'oklch(0.2 0 0)',
        boxShadow: isHovered ? '0 12px 24px rgba(0,0,0,0.4)' : '0 4px 12px rgba(0,0,0,0.2)',
        transition: 'all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
        position: 'relative'
      }}>
        {artUrl ? (
          <img src={artUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: '24px' }}>♪</div>
        )}
        
        {/* Subtle Play Overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.2s'
        }}>
           <div style={{
             width: '40px',
             height: '40px',
             borderRadius: '50%',
             backgroundColor: 'var(--accent)',
             display: 'flex',
             alignItems: 'center',
             justifyContent: 'center',
             color: '#000',
             transform: isHovered ? 'scale(1)' : 'scale(0.8)',
             transition: 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
             paddingLeft: '2px' // optical alignment for play icon
           }}>
             <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">
               <path d="M228.23,116.34L68.23,20.34C58.33,14.41,45.83,14.34,35.88,20.21C25.92,26.07,19.78,36.57,19.78,48v160c0,11.43,6.14,21.93,16.1,27.79c4.95,2.92,10.42,4.39,15.91,4.39c5.6,0,11.16-1.52,16.19-4.52l159.99-96c9.74-5.85,15.71-16.19,15.71-27.52S237.97,122.18,228.23,116.34z" />
             </svg>
           </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {track.title || track.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Unknown'}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 500, width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {track.artist || 'Unknown Artist'}
        </div>
      </div>
    </div>
  );
};

export function HomeView() {
  const { tracks } = useLibraryStore();
  const { play } = usePlayerStore();
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);

  const { topArtists, recentlyPlayed, recentlyAdded } = useMemo(() => {
    // Top Artists
    const artistCounts: Record<string, number> = {};
    for (const t of tracks) {
      if (t.artist && t.artist.toLowerCase() !== 'unknown artist') {
        artistCounts[t.artist] = (artistCounts[t.artist] || 0) + 1;
      }
    }
    const topArtists = Object.entries(artistCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([artist, count]) => ({ artist, count }));

    // Recently Played
    const recentlyPlayed = [...tracks]
      .filter(t => t.last_played)
      .sort((a, b) => (b.last_played || 0) - (a.last_played || 0))
      .slice(0, 12);

    // Recently Added
    const recentlyAdded = [...tracks]
      .filter(t => t.mtime)
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
      .slice(0, 12);

    return { topArtists, recentlyPlayed, recentlyAdded };
  }, [tracks]);

  if (tracks.length === 0) {
    return <div className="empty-library-state">No tracks found. Try scanning a folder!</div>;
  }

  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 18) greeting = 'Good afternoon';

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, 160px)',
    gap: '24px',
    justifyContent: 'space-between'
  };

  if (selectedArtist) {
    const artistTracks = tracks.filter(t => t.artist === selectedArtist);
    return (
      <div className="view-container" style={{ overflowY: 'auto' }}>
        <div className="view-header" style={{ paddingBottom: '0' }}>
          <button
            onClick={() => setSelectedArtist(null)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', marginBottom: '8px', padding: 0, fontSize: '14px' }}
          >
            ← Back to Home
          </button>
          <h2 style={{ fontSize: '32px', fontWeight: 800, margin: '8px 0 24px', color: 'var(--text-primary)' }}>{selectedArtist}</h2>
        </div>
        <div className="view-content track-list">
          {artistTracks.map((track, i) => (
            <TrackRow key={track.id} track={track} index={i} onPlay={() => play(track)} onEdit={() => setEditingTrack(track)} />
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
    <div className="view-container" style={{ overflowY: 'auto' }}>
      <div className="view-header" style={{ paddingBottom: '0' }}>
        <h2 style={{ fontSize: '32px', fontWeight: 800, margin: '24px 0', color: 'var(--text-primary)' }}>
          {greeting}
        </h2>
      </div>
      <div className="view-content" style={{ display: 'flex', flexDirection: 'column', gap: '48px', paddingBottom: '48px', paddingTop: '12px' }}>

        {topArtists.length > 0 && (
          <section>
            <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', color: 'var(--text-primary)' }}>
              Your Artists
            </h3>
            <div style={gridStyle}>
              {topArtists.map((a, i) => (
                <ArtistCard key={i} artist={a.artist} count={a.count} onClick={() => setSelectedArtist(a.artist)} />
              ))}
            </div>
          </section>
        )}

        {recentlyPlayed.length > 0 && (
          <section>
            <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', color: 'var(--text-primary)' }}>
              Recently Played
            </h3>
            <div style={gridStyle}>
              {recentlyPlayed.map((track) => (
                <TrackCard key={`recent-${track.id}`} track={track} onClick={() => play(track)} />
              ))}
            </div>
          </section>
        )}

        {recentlyAdded.length > 0 && (
          <section>
            <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', color: 'var(--text-primary)' }}>
              Recently Added
            </h3>
            <div style={gridStyle}>
              {recentlyAdded.map((track) => (
                <TrackCard key={`added-${track.id}`} track={track} onClick={() => play(track)} />
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
