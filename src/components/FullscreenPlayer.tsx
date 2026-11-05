import { useShallow } from 'zustand/react/shallow';
import { useEffect, useState } from 'react';
import { usePlayerStore, isYouTubeTrack } from '../store/player';
import { useLibraryStore, getArtworkUrl } from '../store/library';
import { handleThumbnailError } from '../utils/thumbnail';
import { CaretDown, Disc, Quotes, Play, Pause, SkipBack, SkipForward, YoutubeLogo } from '@phosphor-icons/react';
import { FullscreenLyrics } from './FullscreenLyrics';
import './FullscreenPlayer.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function FullscreenPlayer({ isOpen, onClose }: Props) {
  const { queue, currentIndex, isPlaying, pause, resume, next, prev } = usePlayerStore(useShallow(s => ({
    queue: s.queue,
    currentIndex: s.currentIndex,
    isPlaying: s.isPlaying,
    pause: s.pause,
    resume: s.resume,
    next: s.next,
    prev: s.prev,
  })));
  const { tracks } = useLibraryStore();
  const [show, setShow] = useState(isOpen);
  const [render, setRender] = useState(isOpen);
  const [showLyrics, setShowLyrics] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRender(true);
      setTimeout(() => setShow(true), 10);
    } else {
      setShow(false);
      setTimeout(() => setRender(false), 300);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!render) return null;

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
  const freshCurrentTrack = currentTrack ? tracks.find(t => t.id === currentTrack.id) || currentTrack : null;
  
  if (!freshCurrentTrack) return null;

  const artUrl = getArtworkUrl(freshCurrentTrack.art_hash);
  const isOnline = isYouTubeTrack(freshCurrentTrack);

  return (
    <div className={`fullscreen-player-overlay ${show ? 'visible' : ''}`}>
      {/* Background with blurred album art */}
      <div 
        className="fullscreen-bg" 
        style={{ backgroundImage: artUrl ? `url(${artUrl})` : 'none' }}
      />
      <div className="fullscreen-bg-dim" />

      {/* Close button */}
      <button className="fullscreen-close" onClick={onClose} title="Close fullscreen" aria-label="Close fullscreen">
        <CaretDown size={32} />
      </button>

      {/* Lyrics Toggle Button */}
      <button 
        className={`fullscreen-toggle-lyrics ${showLyrics ? 'active' : ''}`} 
        onClick={() => setShowLyrics(!showLyrics)}
        title={showLyrics ? 'Hide lyrics' : 'Show lyrics'}
        aria-label={showLyrics ? 'Hide lyrics' : 'Show lyrics'}
      >
        <Quotes size={24} weight={showLyrics ? "bold" : "regular"} />
      </button>

      {/* Main Content */}
      <div className={`fullscreen-content ${showLyrics ? 'has-lyrics' : ''}`}>
        <div className="fullscreen-left-col">
          <div className="fullscreen-art-container">
            {artUrl ? (
              <img
                src={artUrl}
                alt="Album Art"
                className="fullscreen-art-img"
                loading="eager"
                decoding="async"
                onError={handleThumbnailError}
              />
            ) : (
              <div className="fullscreen-art-placeholder">
                <Disc size={120} />
              </div>
            )}
          </div>

          <div className="fullscreen-info">
            <h1 className="fullscreen-title">
              {freshCurrentTrack.title || freshCurrentTrack.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Unknown title'}
            </h1>
            <h2 className="fullscreen-artist">
              {freshCurrentTrack.artist || 'Unknown artist'}
            </h2>
            {freshCurrentTrack.album && (
              <h3 className="fullscreen-album">
                {freshCurrentTrack.album}
              </h3>
            )}
            {isOnline && (
              <div style={{ marginTop: 8 }}>
                <span
                  title="Playing from YouTube Music"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 9px',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: 11,
                    fontWeight: 600,
                    backgroundColor: 'rgba(239, 68, 68, 0.16)',
                    color: '#f87171',
                    letterSpacing: 0,
                  }}
                >
                  <YoutubeLogo size={13} weight="regular" />
                  <span>YouTube Music</span>
                </span>
              </div>
            )}
          </div>
        </div>
        
        <div className="fullscreen-lyrics-wrapper">
          <FullscreenLyrics track={freshCurrentTrack} />
        </div>
      </div>

      {/* Playback Controls */}
      <div className="fullscreen-controls">
        <button className="fullscreen-control-btn" onClick={prev} title="Previous">
          <SkipBack size={28} weight="fill" />
        </button>
        <button className="fullscreen-control-btn play-pause" onClick={() => isPlaying ? pause() : resume()} title={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause size={32} weight="fill" /> : <Play size={32} weight="fill" />}
        </button>
        <button className="fullscreen-control-btn" onClick={next} title="Next">
          <SkipForward size={28} weight="fill" />
        </button>
      </div>
    </div>
  );
}
