import { useShallow } from 'zustand/react/shallow';
import { useEffect, useState, useRef } from 'react';
import { usePlayerStore } from '../store/player';
import { useLibraryStore } from '../store/library';
import { useLyricsStore, getTrackKey } from '../store/lyrics';
import { engine } from '../audio/engine';
import { CircleNotch, Quotes, CaretDown, Plus, Minus } from '@phosphor-icons/react';
import './LyricsPanel.css';

export function LyricsPanel() {
  const { tracks } = useLibraryStore();
  const { queue, currentIndex, position } = usePlayerStore(useShallow(s => ({
    queue: s.queue,
    currentIndex: s.currentIndex,
    position: s.position,
  })));
  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
  const track = currentTrack ? tracks.find(t => t.id === currentTrack.id) || currentTrack : null;

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
    const adjustedPosition = position - offsetMs / 1000;
    for (let i = 0; i < lyrics.length; i++) {
      if (adjustedPosition >= lyrics[i].time) {
        newActive = i;
      } else {
        break;
      }
    }

    if (newActive !== activeIndex) {
      setActiveIndex(newActive);

      if (!isManualScroll.current && containerRef.current && newActive >= 0) {
        const elements = containerRef.current.querySelectorAll('.lyric-line-item');
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

  if (!track) {
    return (
      <div className="lyrics-empty-container">
        <div className="lyrics-empty-sub">No track playing</div>
      </div>
    );
  }

  return (
    <div className="lyrics-panel-wrapper">
      {/* Top Header Bar with Provider Selection Pill and Sync Controls */}
      <div className="lyrics-toolbar">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openModal();
          }}
          className="lyrics-provider-btn"
          title="Change lyrics provider"
        >
          <span className="lyrics-provider-icon">
            <Quotes size={12} weight="bold" />
          </span>
          <span className="lyrics-provider-name">{currentProvider}</span>
          <span className="lyrics-provider-caret">
            <CaretDown size={10} weight="bold" />
          </span>
        </button>

        {!isLoading && trackLyricsReady && lyrics && lyrics.length > 0 && (
          <div className="lyrics-sync-widget">
            <button
              className="lyrics-sync-btn"
              onClick={() => setOffsetMs((o) => o - 500)}
              title="Shift lyrics earlier (-0.5s)"
            >
              <Minus size={11} weight="bold" />
            </button>
            <span className={`lyrics-sync-value ${offsetMs !== 0 ? 'active' : ''}`}>
              {offsetMs > 0 ? '+' : ''}
              {(offsetMs / 1000).toFixed(1)}s
            </span>
            <button
              className="lyrics-sync-btn"
              onClick={() => setOffsetMs((o) => o + 500)}
              title="Shift lyrics later (+0.5s)"
            >
              <Plus size={11} weight="bold" />
            </button>
          </div>
        )}
      </div>

      {/* Lyrics Scrollable Body */}
      <div
        className="lyrics-scroll-container"
        onWheel={handleScroll}
        ref={containerRef}
      >
        {isLoading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              marginTop: '35%',
              color: 'var(--text-tertiary)',
            }}
          >
            <CircleNotch size={24} className="spinning-icon" />
            <span style={{ fontSize: 12 }}>Looking for lyrics on {currentProvider}…</span>
          </div>
        )}

        {!isLoading && trackLyricsReady && lyrics && lyrics.length > 0 && (
          <div
            className={`lyrics-scroll-area ${activeIndex === -1 ? 'is-waiting' : ''}`}
            style={{ paddingBottom: '60%' }}
          >
            {lyrics.map((line, i) => {
              const distance = activeIndex === -1 ? 0 : Math.abs(i - activeIndex);
              return (
                <div
                  key={i}
                  className={`lyric-line-item ${i === activeIndex ? 'is-active' : ''}`}
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
          <div className="lyrics-plain-text">
            {plainText}
          </div>
        )}

        {!isLoading && trackLyricsReady && !lyrics && !plainText && (
          <div className="lyrics-empty-container" style={{ marginTop: '20%' }}>
            <div className="lyrics-empty-title">
              No lyrics found on {currentProvider}
            </div>
            <div className="lyrics-empty-sub">
              Try choosing a different provider below.
            </div>
            <button
              type="button"
              className="lyrics-choose-btn"
              onClick={(e) => {
                e.stopPropagation();
                openModal();
              }}
            >
              Choose Provider
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
