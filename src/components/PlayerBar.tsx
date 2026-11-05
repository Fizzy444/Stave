import { useState, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlayerStore, isYouTubeTrack } from '../store/player';
import { getArtworkUrl, useLibraryStore } from '../store/library';
import { handleThumbnailError } from '../utils/thumbnail';
import { ContextMenu } from './ContextMenu';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Shuffle,
  Repeat,
  RepeatOnce,
  SpeakerHigh,
  SpeakerLow,
  SpeakerSimpleX,
  MicrophoneStage,
  Queue as QueueIcon,
  Heart,
  Disc,
  CircleNotch,
} from '@phosphor-icons/react';

interface PlayerBarProps {
  activePanel?: 'queue' | 'lyrics' | null;
  onTogglePanel?: (panel: 'queue' | 'lyrics') => void;
  onOpenFullscreen?: () => void;
}

export function PlayerBar({ activePanel, onTogglePanel, onOpenFullscreen }: PlayerBarProps) {
  const {
    queue,
    currentIndex,
    isPlaying,
    volume,
    isMuted,
    shuffle,
    repeat,
    position,
    duration,
    isLoadingStream,
    pause,
    resume,
    next,
    prev,
    setVolume,
    toggleMute,
    seek,
    toggleShuffle,
    toggleRepeat,
  } = usePlayerStore(useShallow(state => ({
    queue: state.queue,
    currentIndex: state.currentIndex,
    isPlaying: state.isPlaying,
    volume: state.volume,
    isMuted: state.isMuted,
    shuffle: state.shuffle,
    repeat: state.repeat,
    position: state.position,
    duration: state.duration,
    isLoadingStream: state.isLoadingStream,
    pause: state.pause,
    resume: state.resume,
    next: state.next,
    prev: state.prev,
    setVolume: state.setVolume,
    toggleMute: state.toggleMute,
    seek: state.seek,
    toggleShuffle: state.toggleShuffle,
    toggleRepeat: state.toggleRepeat,
  })));

  const [isHoveringSeek, setIsHoveringSeek] = useState(false);
  const [hoverSeekTime, setHoverSeekTime] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const { toggleFavorite, tracks } = useLibraryStore(useShallow(state => ({
    toggleFavorite: state.toggleFavorite,
    tracks: state.tracks
  })));
  const seekSliderRef = useRef<HTMLDivElement>(null);

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
  // Get fresh track data from library to know if it is favorited
  const freshCurrentTrack = currentTrack ? tracks.find(t => t.id === currentTrack.id) || currentTrack : null;
  const isFavorite = freshCurrentTrack?.favorite || false;

  const formatTime = (timeInSeconds: number) => {
    if (!timeInSeconds || isNaN(timeInSeconds) || timeInSeconds < 0) return '0:00';
    const m = Math.floor(timeInSeconds / 60);
    const s = Math.floor(timeInSeconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatRemaining = (pos: number, dur: number) => {
    if (!dur || isNaN(dur) || dur <= 0) return '--:--';
    const rem = Math.max(0, dur - pos);
    const m = Math.floor(rem / 60);
    const s = Math.floor(rem % 60);
    return `-${m}:${s.toString().padStart(2, '0')}`;
  };

  const getFormatBadge = (track: any): { label: string; isLossless: boolean } => {
    if (isYouTubeTrack(track)) {
      return { label: 'YouTube', isLossless: false };
    }
    const ext = track.path?.split('.').pop()?.toUpperCase() || 'PCM';
    const isLossless = ['FLAC', 'WAV', 'ALAC', 'AIFF'].includes(ext);
    return { label: ext, isLossless };
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;

  const handleSeekMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!seekSliderRef.current || !duration) return;
    const rect = seekSliderRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverSeekTime(pos * duration);
  };

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!seekSliderRef.current || !duration) return;
    const rect = seekSliderRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pos * duration);
  };

  const renderVolumeIcon = () => {
    if (isMuted || volume === 0) return <SpeakerSimpleX size={15} />;
    if (volume < 0.4) return <SpeakerLow size={15} />;
    return <SpeakerHigh size={15} />;
  };

  return (
    <>
      <footer className="player-dock">
        {/* 1. Track Info (Left) */}
        <div 
          className="now-playing-block"
          onContextMenu={(e) => {
            if (freshCurrentTrack) {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY });
            }
          }}
        >
          {freshCurrentTrack ? (
            <>
              <div
                className="now-playing-art"
                onClick={onOpenFullscreen}
                title="Open fullscreen view"
              >
                {freshCurrentTrack.art_hash ? (
                  <img
                    src={getArtworkUrl(freshCurrentTrack.art_hash) || ''}
                    alt=""
                    loading="eager"
                    decoding="async"
                    onError={handleThumbnailError}
                  />
                ) : (
                  <Disc size={20} />
                )}
              </div>
              <div className="now-playing-info">
                <div className="now-playing-title-row">
                  <span className="now-playing-title-text" title={freshCurrentTrack.title || 'Unknown title'}>
                    {freshCurrentTrack.title || (freshCurrentTrack.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Unknown title')}
                  </span>
                  {(() => {
                    const badge = getFormatBadge(freshCurrentTrack);
                    return (
                      <span className={`audio-format-badge ${badge.isLossless ? 'lossless' : ''}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
                <div className="now-playing-artist" title={freshCurrentTrack.artist || 'Unknown artist'}>
                  {freshCurrentTrack.artist || 'Unknown artist'}
                </div>
              </div>
              <button
                className={`btn-icon favorite-btn ${isFavorite ? 'active' : ''}`}
                onClick={() => freshCurrentTrack && toggleFavorite(freshCurrentTrack.id, !isFavorite)}
                title={isFavorite ? 'Favorited' : 'Favorite'}
              >
                <Heart size={14} weight={isFavorite ? 'fill' : 'regular'} />
              </button>
            </>
          ) : (
            <div className="now-playing-empty">
              <span className="now-playing-empty-icon"><Disc size={16} /></span>
              <span>Nothing playing</span>
            </div>
          )}
        </div>

        {/* 2. Playback Controls & Scrubber (Center) */}
        <div className="player-controls-block">
          <div className="player-buttons-row">
            <button
              className={`btn-icon ${shuffle ? 'active' : ''}`}
              onClick={toggleShuffle}
              title={shuffle ? 'Shuffle on' : 'Shuffle off'}
            >
              <Shuffle size={14} weight={shuffle ? 'bold' : 'regular'} />
            </button>

            <button className="btn-icon" onClick={prev} title="Previous">
              <SkipBack size={15} weight="fill" />
            </button>

            <button
              className={`btn-playback-toggle ${isPlaying ? 'playing' : ''}`}
              onClick={isPlaying ? pause : resume}
              disabled={isLoadingStream}
              title={isLoadingStream ? 'Loading…' : (isPlaying ? 'Pause' : 'Play')}
            >
              {isLoadingStream ? (
                <CircleNotch size={15} className="spinning-icon" />
              ) : isPlaying ? (
                <Pause size={15} weight="fill" />
              ) : (
                <Play size={15} weight="fill" />
              )}
            </button>

            <button className="btn-icon" onClick={next} title="Next">
              <SkipForward size={15} weight="fill" />
            </button>

            <button
              className={`btn-icon ${repeat !== 'off' ? 'active' : ''}`}
              onClick={toggleRepeat}
              title={repeat === 'off' ? 'Repeat off' : repeat === 'one' ? 'Repeat one song' : 'Repeat all'}
            >
              {repeat === 'one' ? (
                <RepeatOnce size={14} weight="bold" />
              ) : (
                <Repeat size={14} weight={repeat !== 'off' ? 'bold' : 'regular'} />
              )}
            </button>
          </div>

          {/* Progress & Time */}
          <div className="player-progress-row">
            <span className="time-timestamp">{formatTime(position)}</span>

            <div
              className="slider-container"
              ref={seekSliderRef}
              onClick={handleSeekClick}
              onMouseMove={handleSeekMouseMove}
              onMouseEnter={() => setIsHoveringSeek(true)}
              onMouseLeave={() => {
                setIsHoveringSeek(false);
                setHoverSeekTime(null);
              }}
            >
              <div className="slider-track">
                <div className="slider-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="slider-thumb" style={{ left: `${progressPercent}%` }} />

              {/* Hover Timestamp Preview */}
              {isHoveringSeek && hoverSeekTime !== null && (
                <div
                  className="seek-preview"
                  style={{ left: `${Math.min(95, Math.max(5, (hoverSeekTime / (duration || 1)) * 100))}%` }}
                >
                  {formatTime(hoverSeekTime)}
                </div>
              )}
            </div>

            <span className="time-timestamp remaining">
              {formatRemaining(position, duration)}
            </span>
          </div>
        </div>

        {/* 3. Panel Toggles & Volume (Right) */}
        <div className="player-utilities-block">
          {onTogglePanel && (
            <>
              <button
                className={`btn-icon panel-toggle-btn ${activePanel === 'lyrics' ? 'active' : ''}`}
                onClick={() => onTogglePanel('lyrics')}
                title="Lyrics"
              >
                <MicrophoneStage size={15} />
              </button>

              <button
                className={`btn-icon panel-toggle-btn ${activePanel === 'queue' ? 'active' : ''}`}
                onClick={() => onTogglePanel('queue')}
                title={`Queue (${queue.length} ${queue.length === 1 ? 'song' : 'songs'})`}
              >
                <QueueIcon size={15} />
                {queue.length > 0 && <span className="panel-badge">{queue.length}</span>}
              </button>
            </>
          )}

          <div className="player-utility-divider" />

          {/* Volume */}
          <div className="volume-wrapper">
            <button className="btn-icon volume-toggle" onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
              {renderVolumeIcon()}
            </button>
            <div
              className="slider-container volume-slider"
              title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
              onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const updateVolume = (clientX: number) => {
                  const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                  setVolume(pos);
                };
                updateVolume(e.clientX);

                const handlePointerMove = (ev: PointerEvent) => {
                  updateVolume(ev.clientX);
                };
                const handlePointerUp = () => {
                  window.removeEventListener('pointermove', handlePointerMove);
                  window.removeEventListener('pointerup', handlePointerUp);
                };
                
                window.addEventListener('pointermove', handlePointerMove);
                window.addEventListener('pointerup', handlePointerUp);
              }}
            >
              <div className="slider-track">
                <div className="slider-fill" style={{ width: `${(isMuted ? 0 : volume) * 100}%` }} />
              </div>
              <div className="slider-thumb" style={{ left: `${(isMuted ? 0 : volume) * 100}%`, transform: 'translateX(-50%)' }} />
            </div>
          </div>
        </div>
      </footer>

      {contextMenu && freshCurrentTrack && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          track={freshCurrentTrack}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
