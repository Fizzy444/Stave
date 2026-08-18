import React from 'react';
import { Track, getArtworkUrl } from '../store/library';
import { Play, Pause, PencilSimple, Plus, Disc, Heart } from '@phosphor-icons/react';
import { usePlayerStore } from '../store/player';
import { useLibraryStore } from '../store/library';
import { ContextMenu } from './ContextMenu';
import { useState } from 'react';

interface TrackRowProps {
  track: Track;
  index: number;
  onPlay: (track: Track) => void;
  onEdit: (track: Track) => void;
  style?: React.CSSProperties;
}

export const TrackRow = React.memo(function TrackRow({ track, index, onPlay, onEdit, style }: TrackRowProps) {
  const { queue, currentIndex, isPlaying, pause, resume, addToQueue } = usePlayerStore();
  const toggleFavorite = useLibraryStore(s => s.toggleFavorite);

  const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;
  const isCurrent = currentTrack?.id === track.id;
  const isThisPlaying = isCurrent && isPlaying;
  
  const [contextMenu, setContextMenu] = useState<{x: number, y: number} | null>(null);

  const title = track.title || (track.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Unknown Title');
  const artist = track.artist || 'Unknown Artist';
  const album = track.album || 'Unknown Album';

  const minutes = track.duration_ms ? Math.floor(track.duration_ms / 60000) : 0;
  const seconds = track.duration_ms ? Math.floor((track.duration_ms % 60000) / 1000) : 0;
  const durationStr = track.duration_ms ? `${minutes}:${seconds.toString().padStart(2, '0')}` : '--:--';

  const handlePlayToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCurrent) {
      if (isPlaying) {
        pause();
      } else {
        resume();
      }
    } else {
      onPlay(track);
    }
  };

  return (
    <>
      <div
        className={`track-row ${isCurrent ? 'is-active' : ''}`}
        style={style}
        onClick={() => onPlay(track)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
      {/* Track Index / Play Button */}
      <div className="track-index-box">
        <span className="track-index-num">
          {isThisPlaying ? '▶' : index + 1}
        </span>
        <button className="track-play-btn" onClick={handlePlayToggle} title={isThisPlaying ? 'Pause' : 'Play'}>
          {isThisPlaying ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}
        </button>
      </div>

      {/* Title & Artwork */}
      <div className="track-title-block">
        <div className="track-thumb">
          {track.art_hash ? <img src={getArtworkUrl(track.art_hash) || ''} alt="" style={{width:'100%', height:'100%', objectFit:'cover', borderRadius:'4px'}} /> : <Disc size={16} />}
        </div>
        <div className="track-title-text" title={title}>
          {title}
        </div>
      </div>

      {/* Artist */}
      <div className="track-artist-text" title={artist}>
        {artist}
      </div>

      {/* Album */}
      <div className="track-album-text" title={album}>
        {album}
      </div>

      {/* Actions */}
      <div className="track-actions-cell">
        <button
          className="btn-icon"
          style={{ width: 26, height: 26, color: track.favorite ? '#ef4444' : undefined }}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(track.id, !track.favorite);
          }}
          title={track.favorite ? "Unlike" : "Like"}
        >
          <Heart size={14} weight={track.favorite ? 'fill' : 'regular'} />
        </button>
      </div>

      {/* Duration */}
      <div className="track-time-cell">
        {durationStr}
      </div>
    </div>
    
    {contextMenu && (
      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu(null)}
        items={[
          {
            label: 'Play',
            icon: <Disc size={16} />,
            onClick: () => onPlay(track)
          },
          {
            label: 'Add to Up Next',
            icon: <Plus size={16} />,
            onClick: () => addToQueue(track)
          },
          { divider: true, label: '', onClick: () => {} },
          {
            label: 'Edit Metadata...',
            icon: <PencilSimple size={16} />,
            onClick: () => onEdit(track)
          }
        ]}
      />
    )}
    </>
  );
});
