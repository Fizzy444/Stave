import { useState, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlayerStore } from '../store/player';
import { getArtworkUrl, useLibraryStore } from '../store/library';
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
    if (isMuted || volume === 0) return <SpeakerSimpleX size={16} />;
    if (volume < 0.4) return <SpeakerLow size={16} />;
    return <SpeakerHigh size={16} />;
  };

  return (
    <footer className="player-dock">
      {/* 1. Track Info (Left) */}
      <div className="now-playing-block">
        {freshCurrentTrack ? (
          <>
            <div 
              className="now-playing-art" 
              onClick={onOpenFullscreen} 
              style={{ cursor: 'pointer', transition: 'transform var(--dur-fast)' }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              {freshCurrentTrack.art_hash ? <img src={getArtworkUrl(freshCurrentTrack.art_hash) || ''} alt="" style={{width:'100%', height:'100%', objectFit:'cover', borderRadius:'4px'}} /> : <Disc size={22} />}
            </div>
            <div className="now-playing-info">
              <div className="now-playing-title" title={freshCurrentTrack.title || 'Unknown Title'}>
                {freshCurrentTrack.title || (freshCurrentTrack.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Unknown Title')}
              </div>
              <div className="now-playing-artist" title={freshCurrentTrack.artist || 'Unknown Artist'}>
                {freshCurrentTrack.artist || 'Unknown Artist'}
              </div>
            </div>
            <button
              className="btn-icon"
              style={{ width: 28, height: 28, color: isFavorite ? 'var(--accent)' : 'var(--text-tertiary)' }}
              onClick={() => freshCurrentTrack && toggleFavorite(freshCurrentTrack.id, !isFavorite)}
              title={isFavorite ? 'Favorited' : 'Favorite'}
            >
              <Heart size={15} weight={isFavorite ? 'fill' : 'regular'} />
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontSize: 12 }}>
            <Disc size={18} />
            <span>Not Playing</span>
          </div>
        )}
      </div>

      {/* 2. Playback Controls & Scrubber (Center) */}
      <div className="player-controls-block">
        <div className="player-buttons-row">
          <button
            className={`btn-icon ${shuffle ? 'active' : ''}`}
            onClick={toggleShuffle}
            title={shuffle ? 'Shuffle On' : 'Shuffle'}
          >
            <Shuffle size={16} weight={shuffle ? 'bold' : 'regular'} />
          </button>

          <button className="btn-icon" onClick={prev} title="Previous">
            <SkipBack size={18} weight="fill" />
          </button>

          <button
            className="btn-playback-toggle"
            onClick={isPlaying ? pause : resume}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={17} weight="fill" /> : <Play size={17} weight="fill" style={{ marginLeft: 2 }} />}
          </button>

          <button className="btn-icon" onClick={next} title="Next">
            <SkipForward size={18} weight="fill" />
          </button>

          <button
            className={`btn-icon ${repeat !== 'off' ? 'active' : ''}`}
            onClick={toggleRepeat}
            title={`Repeat: ${repeat}`}
          >
            {repeat === 'one' ? (
              <RepeatOnce size={16} weight="bold" />
            ) : (
              <Repeat size={16} weight={repeat !== 'off' ? 'bold' : 'regular'} />
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
                style={{
                  position: 'absolute',
                  top: -22,
                  left: `${Math.min(95, Math.max(5, (hoverSeekTime / (duration || 1)) * 100))}%`,
                  transform: 'translateX(-50%)',
                  backgroundColor: 'var(--bg-modal)',
                  border: '1px solid var(--divider)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '1px 5px',
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)',
                  pointerEvents: 'none',
                }}
              >
                {formatTime(hoverSeekTime)}
              </div>
            )}
          </div>

          <span className="time-timestamp" style={{ textAlign: 'right' }}>
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* 3. Panel Toggles & Volume (Right) */}
      <div className="player-utilities-block">
        {onTogglePanel && (
          <>
            <button
              className={`btn-icon ${activePanel === 'lyrics' ? 'active' : ''}`}
              onClick={() => onTogglePanel('lyrics')}
              title="Lyrics"
            >
              <MicrophoneStage size={16} />
            </button>

            <button
              className={`btn-icon ${activePanel === 'queue' ? 'active' : ''}`}
              onClick={() => onTogglePanel('queue')}
              title="Up Next"
            >
              <QueueIcon size={16} />
            </button>
          </>
        )}

        <div style={{ width: 1, height: 16, backgroundColor: 'var(--divider)', margin: '0 4px' }} />

        {/* Volume */}
        <div className="volume-wrapper">
          <button className="btn-icon" style={{ width: 26, height: 26 }} onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
            {renderVolumeIcon()}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={isMuted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{ width: 72 }}
          />
        </div>
      </div>
    </footer>
  );
}
