import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Track, getArtworkUrl } from '../store/library';
import { handleThumbnailError } from '../utils/thumbnail';
import { Play, Pause, PencilSimple, Plus, Disc, Heart } from '@phosphor-icons/react';
import { usePlayerStore, prefetchTrackOnHover } from '../store/player';
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
  const { currentTrackId, isPlaying, pause, resume, addToQueue } = usePlayerStore(useShallow(s => ({
    currentTrackId: s.currentIndex >= 0 ? s.queue[s.currentIndex]?.id ?? null : null,
    isPlaying: s.isPlaying,
    pause: s.pause,
    resume: s.resume,
    addToQueue: s.addToQueue,
  })));
  const toggleFavorite = useLibraryStore(s => s.toggleFavorite);

  const isCurrent = currentTrackId === track.id;
  const isThisPlaying = isCurrent && isPlaying;
  
  const [contextMenu, setContextMenu] = useState<{x: number, y: number} | null>(null);

  const isYt = track.source === 'youtube'
    || (track.path != null && track.path.startsWith('yt:'))
    || (typeof track.id === 'string' && track.id.startsWith('yt_'));

  const title = track.title || (isYt ? 'YouTube track' : (track.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Unknown title'));
  const artist = track.artist || 'Unknown artist';
  const album = isYt ? '' : (track.album || 'Unknown album');

  const minutes = track.duration_ms ? Math.floor(track.duration_ms / 60000) : 0;
  const seconds = track.duration_ms ? Math.floor((track.duration_ms % 60000) / 1000) : 0;
  const durationStr = track.duration_ms ? `${minutes}:${seconds.toString().padStart(2, '0')}` : '--:--';

  const ext = isYt
    ? null
    : (track.path && !track.path.startsWith('http') ? (track.path.split('.').pop()?.toUpperCase() || 'PCM') : null);
  const isLossless = ext ? ['FLAC', 'WAV', 'ALAC', 'AIFF'].includes(ext) : false;

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
        onMouseEnter={() => prefetchTrackOnHover(track)}
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
          {isThisPlaying ? <Pause size={12} weight="fill" /> : <Play size={12} weight="fill" />}
        </button>
      </div>

      {/* Title & Artwork */}
      <div className="track-title-block">
        <div className="track-thumb">
          {track.art_hash ? (
            <img
              src={getArtworkUrl(track.art_hash) || ''}
              alt=""
              loading="lazy"
              decoding="async"
              onError={handleThumbnailError}
            />
          ) : (
            <Disc size={13} />
          )}
        </div>
        <span className="track-title-text" title={title}>
          {title}
        </span>
        {ext && (
          <span className={`track-fmt-tag ${isLossless ? 'lossless' : ''}`}>
            {ext}
          </span>
        )}
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
          style={{ width: 22, height: 22, color: track.favorite ? 'var(--accent-clip)' : undefined }}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(track.id, !track.favorite);
          }}
          title={track.favorite ? "Unlike" : "Like"}
        >
          <Heart size={12} weight={track.favorite ? 'fill' : 'regular'} />
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
            label: 'Add to queue',
            icon: <Plus size={16} />,
            onClick: () => addToQueue(track)
          },
          { divider: true, label: '', onClick: () => {} },
          {
            label: 'Edit song info…',
            icon: <PencilSimple size={16} />,
            onClick: () => onEdit(track)
          }
        ]}
      />
    )}
    </>
  );
});
