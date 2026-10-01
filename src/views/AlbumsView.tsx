import { useState, useMemo } from 'react';
import { useLibraryStore, Track, getArtworkUrl } from '../store/library';
import { usePlayerStore } from '../store/player';
import { Disc, Play, CaretLeft } from '@phosphor-icons/react';

export function AlbumsView() {
  const tracks = useLibraryStore(state => state.tracks);
  const playContext = usePlayerStore(state => state.playContext);
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string | null>(null);

  const albums = useMemo(() => {
    const map = new Map<string, { title: string; artist: string; art_hash: string | null; tracks: Track[] }>();
    
    for (const t of tracks) {
      const albumTitle = t.album || 'Unknown Album';
      const artist = t.album_artist || t.artist || 'Unknown Artist';
      const key = `${albumTitle}:::${artist}`;
      
      if (!map.has(key)) {
        map.set(key, { title: albumTitle, artist, art_hash: t.art_hash, tracks: [] });
      }
      const album = map.get(key)!;
      album.tracks.push(t);
      if (!album.art_hash && t.art_hash) {
        album.art_hash = t.art_hash;
      }
    }
    
    const result = Array.from(map.values());
    result.sort((a, b) => a.title.localeCompare(b.title));
    
    result.forEach(a => {
      a.tracks.sort((t1, t2) => {
        if (t1.disc_no !== t2.disc_no) return (t1.disc_no || 1) - (t2.disc_no || 1);
        return (t1.track_no || 0) - (t2.track_no || 0);
      });
    });
    
    return result;
  }, [tracks]);

  const album = selectedAlbumKey ? albums.find(a => `${a.title}:::${a.artist}` === selectedAlbumKey) : null;

  return (
    <>
      <div className="view-container" style={{ display: selectedAlbumKey ? 'none' : 'flex', flexDirection: 'column' }}>
        <div className="view-header" style={{ flexShrink: 0, padding: '48px 32px 24px 32px' }}>
          <h2 style={{ fontSize: '32px', fontWeight: 700, margin: 0, color: 'var(--text-primary)', letterSpacing: '-1px' }}>
            Albums
          </h2>
        </div>
        <div className="view-content" style={{ flex: 1, overflowY: 'auto', padding: '0 32px 32px 32px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '24px' }}>
            {albums.map(a => {
              const key = `${a.title}:::${a.artist}`;
              return (
                <div key={key} onClick={() => setSelectedAlbumKey(key)} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '8px', transition: 'background-color 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)'}>
                  <div style={{ width: '100%', aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
                     {a.art_hash ? <img src={getArtworkUrl(a.art_hash) || ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" /> : <Disc size={48} color="var(--text-tertiary)" />}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                     <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                     <div style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.artist}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedAlbumKey && album && (
        <div className="view-container" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="view-header" style={{ flexShrink: 0, padding: '32px 32px 24px 32px', display: 'flex', gap: '32px', alignItems: 'flex-end', position: 'relative' }}>
            <button onClick={() => setSelectedAlbumKey(null)} className="btn-icon" style={{ position: 'absolute', top: '16px', left: '16px', zIndex: 10 }}>
               <CaretLeft size={24} />
            </button>
            
            <div style={{ width: '200px', height: '200px', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '24px' }}>
              {album.art_hash ? <img src={getArtworkUrl(album.art_hash) || ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Disc size={64} color="var(--text-tertiary)" />}
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '8px' }}>
               <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Album</div>
               <h2 style={{ fontSize: '48px', fontWeight: 800, margin: 0, color: 'var(--text-primary)', letterSpacing: '-1.5px', lineHeight: 1.1 }}>{album.title}</h2>
               <div style={{ fontSize: '16px', color: 'var(--text-secondary)', fontWeight: 500 }}>{album.artist} • {album.tracks.length} songs</div>
               <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
                 <button className="btn-primary" onClick={() => playContext(album.tracks, 0)} style={{ width: '48px', height: '48px', borderRadius: '50%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                   <Play size={24} weight="fill" />
                 </button>
               </div>
            </div>
          </div>
          
          <div className="view-content" style={{ flex: 1, overflowY: 'auto', padding: '0 32px 32px 32px' }}>
             {album.tracks.map((track, i) => (
               <div key={track.id} className="library-row" onClick={() => playContext(album.tracks, i)} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 50px', gap: '16px', padding: '0 16px', height: '56px', alignItems: 'center', borderRadius: '6px', cursor: 'pointer', transition: 'background-color 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-hover)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '14px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{track.track_no || i + 1}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: '15px', fontWeight: 500 }}>{track.title || track.path.split(/[\\/]/).pop()}</div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{track.artist || 'Unknown Artist'}</div>
                  </div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {track.duration_ms ? `${Math.floor(track.duration_ms / 60000)}:${String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, '0')}` : '--:--'}
                  </div>
               </div>
             ))}
          </div>
        </div>
      )}
    </>
  );
}
