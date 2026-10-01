import { useEffect, useState } from 'react';
import { usePlayerStore } from '../store/player';
import { useLibraryStore, getArtworkUrl } from '../store/library';
import { CaretDown, Disc, Quotes, Play, Pause, SkipBack, SkipForward } from '@phosphor-icons/react';
import { FullscreenLyrics } from './FullscreenLyrics';
import './FullscreenPlayer.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function FullscreenPlayer({ isOpen, onClose }: Props) {
  const { queue, currentIndex, isPlaying, pause, resume, next, prev } = usePlayerStore();
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

  return (
    <div className={`fullscreen-player-overlay ${show ? 'visible' : ''}`}>
      {/* Background with blurred album art */}
      <div 
        className="fullscreen-bg" 
        style={{ backgroundImage: artUrl ? `url(${artUrl})` : 'none' }}
      />
      <div className="fullscreen-bg-dim" />

      {/* Close button */}
      <button className="fullscreen-close" onClick={onClose}>
        <CaretDown size={32} />
      </button>

      {/* Lyrics Toggle Button */}
      <button 
        className={`fullscreen-toggle-lyrics ${showLyrics ? 'active' : ''}`} 
        onClick={() => setShowLyrics(!showLyrics)}
        title="Toggle Lyrics"
      >
        <Quotes size={24} weight={showLyrics ? "bold" : "regular"} />
      </button>

      {/* Main Content */}
      <div className={`fullscreen-content ${showLyrics ? 'has-lyrics' : ''}`}>
        <div className="fullscreen-left-col">
          <div className="fullscreen-art-container">
            {artUrl ? (
              <img src={artUrl} alt="Album Art" className="fullscreen-art-img" />
            ) : (
              <div className="fullscreen-art-placeholder">
                <Disc size={120} />
              </div>
            )}
          </div>

          <div className="fullscreen-info">
            <h1 className="fullscreen-title">
              {freshCurrentTrack.title || freshCurrentTrack.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Unknown Title'}
            </h1>
            <h2 className="fullscreen-artist">
              {freshCurrentTrack.artist || 'Unknown Artist'}
            </h2>
            {freshCurrentTrack.album && (
              <h3 className="fullscreen-album">
                {freshCurrentTrack.album}
              </h3>
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
