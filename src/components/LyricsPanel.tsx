import { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore } from '../store/player';
import { parseLrc, LyricLine } from '../lyrics/parseLrc';
import { engine } from '../audio/engine';
import { CircleNotch } from '@phosphor-icons/react';

export function LyricsPanel() {
  const { queue, currentIndex, position } = usePlayerStore();
  const track = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [plainText, setPlainText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const isManualScroll = useRef(false);
  const scrollTimeout = useRef<number | undefined>(undefined);

  const [offsetMs, setOffsetMs] = useState(0);

  useEffect(() => {
    if (!track) {
      setLyrics(null);
      setPlainText(null);
      setOffsetMs(0);
      return;
    }

    let active = true;
    setIsLoading(true);
    setLyrics(null);
    setPlainText(null);
    setOffsetMs(0);

    invoke<{ synced: string | null; plain: string | null }>('fetch_lyrics', {
      trackId: track.id,
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || '',
      durationMs: track.duration_ms || 0,
    })
      .then((res) => {
        if (!active) return;
        if (res.synced) {
          setLyrics(parseLrc(res.synced));
        } else if (res.plain) {
          setPlainText(res.plain);
        }
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('Lyrics error:', err);
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [track?.id]);

  useEffect(() => {
    if (!lyrics || lyrics.length === 0) return;

    let newActive = -1;
    const adjustedPosition = position - (offsetMs / 1000);
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
      <div className="empty-library-state">
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No track playing</div>
      </div>
    );
  }

  return (
    <div
      className="lyrics-container"
      onWheel={handleScroll}
      ref={containerRef}
      style={{ position: 'relative' }}
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
          <span style={{ fontSize: 12 }}>Loading Lyrics...</span>
        </div>
      )}

      {!isLoading && lyrics && lyrics.length > 0 && (
        <>
          <div className={`lyrics-scroll-area ${activeIndex === -1 ? 'is-waiting' : ''}`} style={{ paddingBottom: '60%' }}>
            {lyrics.map((line, i) => {
              const distance = activeIndex === -1 ? 0 : Math.abs(i - activeIndex);
              return (
                <div
                  key={i}
                  className={`lyric-line-item ${i === activeIndex ? 'is-active' : ''}`}
                  style={{ '--distance': distance } as React.CSSProperties}
                  onClick={() => engine.seek(line.time + (offsetMs / 1000))}
                >
                  {line.text || '♪'}
                </div>
              );
            })}
          </div>
          
          <div style={{
            position: 'fixed',
            bottom: '100px',
            right: '32px',
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'oklch(0.18 0 0 / 0.8)',
            backdropFilter: 'blur(12px)',
            borderRadius: '24px',
            padding: '4px',
            border: '1px solid var(--divider)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            zIndex: 10
          }}>
            <button 
              className="btn-icon" 
              onClick={() => setOffsetMs(o => o - 500)}
              title="Shift lyrics earlier (-0.5s)"
              style={{ width: '28px', height: '28px', color: 'var(--text-primary)' }}
            >
              -
            </button>
            <span style={{ 
              fontSize: '11px', 
              fontWeight: 600, 
              color: offsetMs === 0 ? 'var(--text-tertiary)' : 'var(--accent)',
              width: '40px',
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums'
            }}>
              {offsetMs > 0 ? '+' : ''}{(offsetMs / 1000).toFixed(1)}s
            </span>
            <button 
              className="btn-icon" 
              onClick={() => setOffsetMs(o => o + 500)}
              title="Shift lyrics later (+0.5s)"
              style={{ width: '28px', height: '28px', color: 'var(--text-primary)' }}
            >
              +
            </button>
          </div>
        </>
      )}

      {!isLoading && !lyrics && plainText && (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            color: 'var(--text-secondary)',
            fontSize: 15,
            lineHeight: 1.7,
            padding: '16px 0',
          }}
        >
          {plainText}
        </div>
      )}

      {!isLoading && !lyrics && !plainText && (
        <div className="empty-library-state" style={{ marginTop: '30%' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
            No Lyrics Available
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            Instrumental or not available on LRCLIB.
          </div>
        </div>
      )}
    </div>
  );
}
