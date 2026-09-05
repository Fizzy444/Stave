import { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore } from '../store/player';
import { parseLrc, LyricLine } from '../lyrics/parseLrc';
import { engine } from '../audio/engine';
import { CircleNotch } from '@phosphor-icons/react';
import { Track } from '../store/library';

interface Props {
  track: Track;
}

export function FullscreenLyrics({ track }: Props) {
  const { position } = usePlayerStore();
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [plainText, setPlainText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const isManualScroll = useRef(false);
  const scrollTimeout = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLyrics(null);
    setPlainText(null);

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
  }, [track.id]);

  useEffect(() => {
    if (!lyrics || lyrics.length === 0) return;

    let newActive = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (position >= lyrics[i].time) {
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
  }, [position, lyrics, activeIndex]);

  const handleScroll = () => {
    isManualScroll.current = true;
    clearTimeout(scrollTimeout.current);
    scrollTimeout.current = window.setTimeout(() => {
      isManualScroll.current = false;
    }, 2500);
  };

  return (
    <div
      className="fs-lyrics-container"
      onWheel={handleScroll}
      ref={containerRef}
    >
      {isLoading && (
        <div className="fs-lyrics-loading">
          <CircleNotch size={48} className="spinning-icon" />
        </div>
      )}

      {!isLoading && lyrics && lyrics.length > 0 && (
        <div className={`fs-lyrics-scroll-area ${activeIndex === -1 ? 'is-waiting' : ''}`}>
          {lyrics.map((line, i) => {
            const distance = activeIndex === -1 ? 0 : Math.abs(i - activeIndex);
            return (
              <div
                key={i}
                className={`fs-lyric-item ${i === activeIndex ? 'is-active' : ''}`}
                style={{ '--distance': distance } as React.CSSProperties}
                onClick={() => engine.seek(line.time)}
              >
                {line.text || '♪'}
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && !lyrics && plainText && (
        <div className="fs-lyrics-plain">
          {plainText}
        </div>
      )}

      {!isLoading && !lyrics && !plainText && (
        <div className="fs-lyrics-empty">
          <h2>No Lyrics Available</h2>
          <p>Instrumental or not available on LRCLIB.</p>
        </div>
      )}
    </div>
  );
}
