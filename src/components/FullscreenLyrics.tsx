import { useShallow } from 'zustand/react/shallow';
import { useEffect, useState, useRef } from 'react';
import { usePlayerStore } from '../store/player';
import { useLyricsStore, getTrackKey } from '../store/lyrics';
import { engine } from '../audio/engine';
import { CircleNotch, Plus, Minus, Quotes, CaretDown } from '@phosphor-icons/react';
import { Track } from '../store/library';

interface Props {
  track: Track;
}

export function FullscreenLyrics({ track }: Props) {
  const { position } = usePlayerStore(useShallow(s => ({ position: s.position })));
  const {
    lyrics,
    plainText,
    isLoading,
    currentProvider,
    offsetMs,
    activeTrackKey,
    setOffsetMs,
    openModal,
    fetchForTrack,
  } = useLyricsStore();

  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const isManualScroll = useRef(false);
  const scrollTimeout = useRef<number | undefined>(undefined);

  const trackKey = getTrackKey(track);

  useEffect(() => {
    setActiveIndex(-1);
    isManualScroll.current = false;
    if (containerRef.current) containerRef.current.scrollTop = 0;
    void fetchForTrack(track);
  }, [trackKey, fetchForTrack]);

  const trackLyricsReady = activeTrackKey === trackKey;

  useEffect(() => {
    if (!lyrics || lyrics.length === 0) return;

    let newActive = -1;
    const effectivePosition = position - offsetMs / 1000;

    for (let i = 0; i < lyrics.length; i++) {
      if (effectivePosition >= lyrics[i].time) {
        newActive = i;
      } else {
        break;
      }
    }

    if (newActive !== activeIndex) {
      setActiveIndex(newActive);

      if (!isManualScroll.current && containerRef.current && newActive >= 0) {
        const elements = containerRef.current.querySelectorAll('.fs-lyric-item');
        const el = elements[newActive] as HTMLElement;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }, [position, lyrics, activeIndex, offsetMs]);

  const handleScroll = () => {
    isManualScroll.current = true;
    clearTimeout(scrollTimeout.current);
    scrollTimeout.current = window.setTimeout(() => {
      isManualScroll.current = false;
    }, 2500);
  };

  return (
    <div className="fs-lyrics-container" onWheel={handleScroll} ref={containerRef}>
      {/* Top right sync & provider controls */}
      <div className="fs-sync-controls">
        <button
          className="fs-provider-btn"
          onClick={openModal}
          title="Change lyrics provider"
          style={{ marginRight: lyrics && lyrics.length > 0 ? '8px' : '0' }}
        >
          <Quotes size={12} weight="bold" />
          <span>{currentProvider}</span>
          <CaretDown size={10} weight="bold" style={{ opacity: 0.7 }} />
        </button>

        {!isLoading && lyrics && lyrics.length > 0 && (
          <>
            <span className="fs-sync-label">Sync</span>
            <button
              className="fs-sync-btn"
              onClick={() => setOffsetMs((o) => o - 500)}
              title="Delay lyrics by 0.5s"
            >
              <Minus size={14} weight="bold" />
            </button>
            <span className="fs-sync-value">
              {offsetMs > 0 ? '+' : ''}
              {offsetMs / 1000}s
            </span>
            <button
              className="fs-sync-btn"
              onClick={() => setOffsetMs((o) => o + 500)}
              title="Advance lyrics by 0.5s"
            >
              <Plus size={14} weight="bold" />
            </button>
          </>
        )}
      </div>

      {isLoading && (
        <div className="fs-lyrics-loading">
          <CircleNotch size={48} className="spinning-icon" />
          <div style={{ marginTop: '16px', fontSize: '14px', color: 'rgba(255, 255, 255, 0.6)' }}>
            Looking for lyrics on {currentProvider}…
          </div>
        </div>
      )}

      {!isLoading && trackLyricsReady && lyrics && lyrics.length > 0 && (
        <div className={`fs-lyrics-scroll-area ${activeIndex === -1 ? 'is-waiting' : ''}`}>
          {lyrics.map((line, i) => {
            const distance = activeIndex === -1 ? 0 : Math.abs(i - activeIndex);
            return (
              <div
                key={i}
                className={`fs-lyric-item ${i === activeIndex ? 'is-active' : ''}`}
                style={{ '--distance': distance } as React.CSSProperties}
                onClick={() => engine.seek(line.time + offsetMs / 1000)}
              >
                {line.text || '♪'}
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && trackLyricsReady && !lyrics && plainText && (
        <div className="fs-lyrics-plain">{plainText}</div>
      )}

      {!isLoading && trackLyricsReady && !lyrics && !plainText && (
        <div className="fs-lyrics-empty">
          <h2>No lyrics available</h2>
          <p>Lyrics were not found on {currentProvider}.</p>
          <button
            onClick={openModal}
            style={{
              marginTop: '16px',
              padding: '8px 20px',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)')}
          >
            Try another provider
          </button>
        </div>
      )}
    </div>
  );
}
