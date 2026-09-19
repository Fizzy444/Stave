import { useSearchStore } from '../store/search';
import { usePlayerStore } from '../store/player';
import { getArtworkUrl, Track } from '../store/library';
import { Disc, Plus, Clock, PencilSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { TagEditor } from '../components/TagEditor';
import { ContextMenu } from '../components/ContextMenu';

const formatDate = (secs: number) => {
  const d = new Date(secs * 1000);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatDuration = (ms: number) => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export function SearchView() {
  const { query, results, isSearching } = useSearchStore();
  const { playContext, queue, currentIndex, isPlaying, addToQueue } = usePlayerStore();
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [contextMenu, setContextMenu] = useState<{x: number, y: number, track: Track} | null>(null);

  const currentTrackId = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex].id : null;

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="view-header" style={{ paddingBottom: '24px', flexShrink: 0 }}>
        <h2 style={{ fontSize: '28px', fontWeight: 700, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
          Search Results
        </h2>
        <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', fontWeight: 500, marginTop: '6px' }}>
          {isSearching ? 'Searching...' : `Found ${results.length} results for "${query}"`}
        </div>
      </div>

      <div className="view-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>

        {results.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '40px minmax(200px, 2fr) minmax(150px, 1.5fr) minmax(100px, 1fr) 50px',
            gap: '16px',
            padding: '0 16px',
            margin: '0 16px 8px 16px',
            height: '36px',
            alignItems: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '4px',
            fontSize: '11px',
            color: 'var(--text-tertiary)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            flexShrink: 0
          }}>
            <div style={{ textAlign: 'center' }}>#</div>
            <div style={{ paddingLeft: '52px' }}>TITLE</div>
            <div>ALBUM</div>
            <div>DATE ADDED</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
              <Clock size={14} />
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px', paddingBottom: '32px' }}>
          {results.length === 0 && !isSearching && (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-tertiary)' }}>
              No tracks found matching "{query}"
            </div>
          )}
          {results.map((track, i) => {
            const isCurrent = currentTrackId === track.id;
            const isThisPlaying = isCurrent && isPlaying;
            const title = track.title || track.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Unknown Title';

            return (
              <div
                key={track.id}
                className={`library-row ${isCurrent ? 'is-active' : ''}`}
                onClick={() => playContext(results, i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, track });
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '40px minmax(200px, 2fr) minmax(150px, 1.5fr) minmax(100px, 1fr) 50px',
                  gap: '16px',
                  alignItems: 'center',
                  height: '56px',
                  borderRadius: '6px',
                  padding: '0 16px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                  backgroundColor: isCurrent ? 'var(--surface-selected)' : 'transparent',
                }}
                onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.backgroundColor = 'var(--surface-hover)' }}
                onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                <div style={{ textAlign: 'center', fontSize: '14px', color: isCurrent ? 'var(--accent)' : 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  {isThisPlaying ? '▶' : i + 1}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <div style={{ width: '40px', height: '40px', flexShrink: 0, borderRadius: '4px', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {track.art_hash ? <img src={getArtworkUrl(track.art_hash) || ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Disc size={20} color="var(--text-tertiary)" />}
                  </div>
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px' }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: isCurrent ? 'var(--accent)' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {title}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {track.artist || 'Unknown Artist'}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {track.album || ''}
                </div>

                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {track.mtime ? formatDate(track.mtime) : ''}
                </div>

                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); addToQueue(track); }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 0 }}
                    title="Add to Up Next"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingTrack(track); }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 0 }}
                    title="Edit Metadata"
                  >
                    <PencilSimple size={14} />
                  </button>
                  <div style={{ width: '35px', textAlign: 'right' }}>
                    {track.duration_ms ? formatDuration(track.duration_ms) : '--:--'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editingTrack && (
        <TagEditor
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Play',
              icon: <Disc size={16} />,
              onClick: () => playContext(results, results.findIndex(t => t.id === contextMenu.track.id))
            },
            {
              label: 'Add to Up Next',
              icon: <Plus size={16} />,
              onClick: () => addToQueue(contextMenu.track)
            },
            { divider: true, label: '', onClick: () => {} },
            {
              label: 'Edit Metadata...',
              icon: <PencilSimple size={16} />,
              onClick: () => setEditingTrack(contextMenu.track)
            }
          ]}
        />
      )}
    </div>
  );
}
