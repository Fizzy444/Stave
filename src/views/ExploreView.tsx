import { useShallow } from 'zustand/react/shallow';
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Compass,
  Play,
  Pause,
  Plus,
  DownloadSimple,
  CaretLeft,
  CaretRight,
  ArrowsClockwise,
  ChartLineUp,
  Disc,
  Playlist,
  Check,
  Link,
  Shuffle,
} from '@phosphor-icons/react';
import { invoke } from '@tauri-apps/api/core';
import {
  ytItemToTrack,
  YTSection,
  YTTrackItem
} from '../store/ytmusic';
import { useMetadataStore } from '../store/metadata';
import { getHighResThumbnail, handleThumbnailError } from '../utils/thumbnail';
import { usePlayerStore, prefetchTrackOnHover } from '../store/player';
import { ContextMenu, ContextMenuItem } from '../components/ContextMenu';

export { getHighResThumbnail, handleThumbnailError };

const formatDurationSecs = (secs: number) => {
  if (!secs || isNaN(secs)) return '--:--';
  const minutes = Math.floor(secs / 60);
  const remaining = Math.floor(secs % 60);
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
};

export interface MoodGenreCategory {
  id: string;
  name: string;
  searchQuery: string;
}

export const MOODS_AND_GENRES: MoodGenreCategory[] = [
  // Row 1: Core Global Genres
  {
    id: 'pop',
    name: 'Pop Hits',
    searchQuery: 'popular global pop songs'
  },
  {
    id: 'hiphop',
    name: 'Hip-Hop & Rap',
    searchQuery: 'top global hip hop rap bangers hits'
  },
  {
    id: 'rock',
    name: 'Rock & Alt',
    searchQuery: 'top modern rock alternative rock classics hits'
  },
  {
    id: 'electronic',
    name: 'Electronic & Dance',
    searchQuery: 'top edm electronic dance club festival hits'
  },
  {
    id: 'rnb',
    name: 'R&B & Soul',
    searchQuery: 'top modern rnb soul smooth hits'
  },

  // Row 2: Vibes & Atmospheres
  {
    id: 'indie',
    name: 'Indie & Bedroom',
    searchQuery: 'top indie alternative bedroom pop hits modern'
  },
  {
    id: 'chill',
    name: 'Chill & Lo-Fi',
    searchQuery: 'lofi hip hop chill beats study relax'
  },
  {
    id: 'synthwave',
    name: 'Synthwave & Retro',
    searchQuery: 'synthwave retrowave 80s electronic cyberpunk beats'
  },
  {
    id: 'kpop',
    name: 'K-Pop',
    searchQuery: 'popular k-pop songs'
  },
  {
    id: 'latin',
    name: 'Latin & Reggaeton',
    searchQuery: 'top latin reggaeton urban hits global'
  },

  // Row 3: Moods & Activities
  {
    id: 'workout',
    name: 'Workout & Gym',
    searchQuery: 'high energy workout gym pump motivation edm hip hop'
  },
  {
    id: 'nightdrive',
    name: 'Night Drive',
    searchQuery: 'late night drive moody synthwave alternative vibes'
  },
  {
    id: 'focus',
    name: 'Focus & Deep Work',
    searchQuery: 'ambient focus deep work instrumental synth calm'
  },
  {
    id: 'feelgood',
    name: 'Feel-Good',
    searchQuery: 'feel good happy upbeat pop indie summer hits'
  },
  {
    id: 'sleep',
    name: 'Sleep & Ambient',
    searchQuery: 'deep sleep calm ambient peaceful piano waves'
  },

  // Row 4: Classic, Global & Heritage
  {
    id: 'afrobeats',
    name: 'Afrobeats & Amapiano',
    searchQuery: 'top afrobeats amapiano global hits'
  },
  {
    id: 'jazz',
    name: 'Jazz & Blues',
    searchQuery: 'smooth evening jazz blues lounge classics'
  },
  {
    id: 'classical',
    name: 'Classical & Piano',
    searchQuery: 'beautiful piano symphony classical orchestral'
  },
  {
    id: 'metal',
    name: 'Metal & Hard Rock',
    searchQuery: 'heavy metal hard rock classics modern'
  },
  {
    id: 'decades8090',
    name: '80s & 90s Hits',
    searchQuery: 'greatest hits 80s 90s classic pop rock throwback'
  },

  // Row 5: Nostalgia & Specialized
  {
    id: 'decades2000s',
    name: '2000s & 2010s',
    searchQuery: 'top hits 2000s 2010s pop rock nostalgia'
  },
  {
    id: 'acoustic',
    name: 'Acoustic & Coffee',
    searchQuery: 'acoustic folk mellow morning coffee shop blend'
  },
  {
    id: 'party',
    name: 'Party & Celebration',
    searchQuery: 'dance party celebration floor fillers bangers hits'
  },
  {
    id: 'country',
    name: 'Country & Americana',
    searchQuery: 'top country americana acoustic hits modern'
  }
];

interface ExploreViewProps {
  onOpenPlaylist?: (playlistId: string) => void;
}

export function ExploreView({ onOpenPlaylist }: ExploreViewProps) {
  const [activeTab, setActiveTab] = useState<'moods' | 'trending'>('trending');
  const [selectedGenre, setSelectedGenre] = useState<MoodGenreCategory | null>(null);
  const [genreTracks, setGenreTracks] = useState<YTTrackItem[]>([]);
  const [genreLoading, setGenreLoading] = useState<boolean>(false);
  const [selectedRegion, setSelectedRegion] = useState<string>('global');

  // Metadata store cache
  const exploreCache = useMetadataStore((s) => s.explore[selectedRegion]);
  const fetchExplore = useMetadataStore((s) => s.fetchExplore);
  const fetchSearch = useMetadataStore((s) => s.fetchSearch);
  const searchCache = useMetadataStore((s) => s.search);

  const exploreData = exploreCache?.data?.exploreData ?? null;
  const globalTrendingTracks = exploreCache?.data?.trending ?? [];
  const hasData = Boolean(
    globalTrendingTracks.length > 0 || (exploreData?.sections && exploreData.sections.length > 0)
  );
  const loading = exploreCache ? (exploreCache.loading && !hasData) : !hasData;
  const isRefreshing = Boolean(exploreCache?.loading && hasData);
  const error = exploreCache?.error ?? null;

  // Hero carousel index
  const [heroIndex, setHeroIndex] = useState<number>(0);
  const [isHeroPaused, setIsHeroPaused] = useState<boolean>(false);

  // Downloads feedback
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: YTTrackItem;
    section?: YTSection;
    index: number;
  } | null>(null);

  const carouselRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const { queue, currentIndex, isPlaying, playDiscover, playContext, addToQueue, playNext, pause, resume } = usePlayerStore(useShallow(s => ({
    queue: s.queue,
    currentIndex: s.currentIndex,
    isPlaying: s.isPlaying,
    playDiscover: s.playDiscover,
    playContext: s.playContext,
    addToQueue: s.addToQueue,
    playNext: s.playNext,
    pause: s.pause,
    resume: s.resume,
  })));
  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  useEffect(() => {
    fetchExplore(selectedRegion);
  }, [selectedRegion, fetchExplore]);

  // When a genre is clicked, fetch its tracks (cached via search in useMetadataStore)
  const handleSelectGenre = async (genre: MoodGenreCategory) => {
    setSelectedGenre(genre);
    const key = `${genre.searchQuery.toLowerCase()}|songs`;
    const cached = searchCache[key]?.data;
    if (cached && cached.length > 0) {
      setGenreTracks(cached);
      setGenreLoading(false);
      return;
    }
    setGenreLoading(true);
    try {
      const results = await fetchSearch(genre.searchQuery, 'songs');
      setGenreTracks(results || []);
    } catch (e) {
      console.error('Failed to load category tracks:', e);
      setGenreTracks([]);
    } finally {
      setGenreLoading(false);
    }
  };

  const handlePlayCategoryAll = (shuffle: boolean = false) => {
    if (genreTracks.length === 0) return;
    const tracks = genreTracks.map(ytItemToTrack);
    const label = selectedGenre?.name || 'Genre Mix';
    if (shuffle) {
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      playContext(shuffled, 0, { contextLabel: label });
    } else {
      playContext(tracks, 0, { contextLabel: label });
    }
  };

  // Top highlight items for hero banner (prioritizing global trending international tracks)
  const heroItems = useMemo(() => {
    if (globalTrendingTracks.length > 0) {
      return globalTrendingTracks.slice(0, 6);
    }
    if (exploreData?.sections && exploreData.sections.length > 0) {
      const firstSectionItems = exploreData.sections[0]?.items || [];
      return firstSectionItems.slice(0, 6);
    }
    return [];
  }, [globalTrendingTracks, exploreData]);

  // Auto-advance hero carousel every 7 seconds
  useEffect(() => {
    if (heroItems.length <= 1 || isHeroPaused) return;
    const interval = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % heroItems.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [heroItems.length, isHeroPaused]);

  const activeHeroItem = heroItems[heroIndex] || heroItems[0];

  const scrollCarousel = (index: number, direction: -1 | 1) => {
    const el = carouselRefs.current[index];
    if (el) {
      const scrollAmount = el.clientWidth * 0.75 * direction;
      el.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handlePlayTrack = (trackItem: YTTrackItem, _contextList?: YTTrackItem[], _index?: number) => {
    const itemCleanId = trackItem.id.replace(/^(yt:|yt_)/, '');
    const currentCleanId = String(currentTrack?.path || currentTrack?.id || '').replace(/^(yt:|yt_)/, '');

    if (itemCleanId === currentCleanId) {
      if (isPlaying) {
        pause();
      } else {
        resume();
      }
      return;
    }

    // Discover card click: start a single-track session (seed + 10 auto)
    playDiscover(ytItemToTrack(trackItem));
  };

  const handleDownloadItem = async (item: YTTrackItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const cleanId = item.id.replace(/^(yt:|yt_)/, '');
    try {
      await invoke('queue_download', {
        id: cleanId,
        title: item.title,
        artist: item.artist
      });
      setDownloadedIds((prev) => new Set(prev).add(cleanId));
      setTimeout(() => {
        setDownloadedIds((prev) => {
          const next = new Set(prev);
          next.delete(cleanId);
          return next;
        });
      }, 3000);
    } catch (err) {
      console.error('Failed to queue download:', err);
    }
  };

  const isItemActive = (id: string) => {
    if (!currentTrack) return false;
    const cleanId = id.replace(/^(yt:|yt_)/, '');
    const trackCleanId = String(currentTrack.path || currentTrack.id || '').replace(/^(yt:|yt_)/, '');
    return cleanId === trackCleanId;
  };

  const getContextMenuItems = (): ContextMenuItem[] => {
    if (!contextMenu) return [];
    const { item } = contextMenu;
    const cleanId = item.id.replace(/^(yt:|yt_)/, '');

    return [
      {
        label: isItemActive(item.id) && isPlaying ? 'Pause' : 'Play',
        icon: isItemActive(item.id) && isPlaying ? <Pause size={16} /> : <Play size={16} />,
        onClick: () => {
          handlePlayTrack(item);
        }
      },
      {
        label: 'Play next',
        icon: <Play size={16} />,
        onClick: () => playNext(ytItemToTrack(item))
      },
      {
        label: 'Add to queue',
        icon: <Plus size={16} />,
        onClick: () => addToQueue(ytItemToTrack(item))
      },
      { divider: true, label: '', onClick: () => {} },
      {
        label: downloadedIds.has(cleanId) ? 'Queued for Download' : 'Download',
        icon: downloadedIds.has(cleanId) ? <Check size={16} /> : <DownloadSimple size={16} />,
        onClick: () => handleDownloadItem(item)
      },
      {
        label: 'Copy link',
        icon: <Link size={16} />,
        onClick: () => {
          navigator.clipboard?.writeText(`https://youtube.com/watch?v=${cleanId}`);
        }
      }
    ];
  };

  return (
    <div className="view-container explore-view-container">
      {/* 1. Header Bar with Tabs */}
      <div className="explore-header">
        <div className="explore-header-left">
          <h2 className="explore-main-title">Find something new</h2>
          <p className="explore-main-sub">Charts, moods, and playlists from YouTube Music</p>
        </div>

        <div className="explore-header-actions">
          {onOpenPlaylist && (
            <button
              className="btn-secondary explore-playlist-btn"
              onClick={() => onOpenPlaylist('')}
              title="Open a YouTube playlist or album by link"
            >
              <Playlist size={15} weight="regular" />
              <span>Open playlist link</span>
            </button>
          )}

          <button
            className="btn-icon explore-refresh-btn"
            onClick={() => fetchExplore(selectedRegion, true)}
            title="Refresh"
            disabled={loading || isRefreshing}
          >
            <ArrowsClockwise size={16} className={(loading || isRefreshing) ? 'spinning-icon' : ''} />
          </button>
        </div>
      </div>

      <div className="explore-content hide-scrollbar">
        {/* Navigation Tabs & Region Selector */}
        <div className="explore-nav-bar">
          <div className="moods-genres-tabs">
            <button
              className={`moods-genres-tab-btn ${activeTab === 'trending' ? 'active' : ''}`}
              onClick={() => {
                setSelectedGenre(null);
                setActiveTab('trending');
              }}
            >
              <ChartLineUp size={15} />
              <span>Popular songs</span>
            </button>

            <button
              className={`moods-genres-tab-btn ${activeTab === 'moods' && !selectedGenre ? 'active' : ''}`}
              onClick={() => {
                setSelectedGenre(null);
                setActiveTab('moods');
              }}
            >
              <Disc size={15} weight="regular" />
              <span>Moods &amp; genres</span>
            </button>


          </div>

          {activeTab === 'trending' && (
            <div className="explore-region-pill-group">
              <span className="explore-region-label">Region</span>
              {[
                { id: 'global', name: 'Global' },
                { id: 'us', name: 'US' },
                { id: 'uk', name: 'UK' },
                { id: 'japan', name: 'Japan' }
              ].map((reg) => (
                <button
                  key={reg.id}
                  className={`explore-region-pill ${selectedRegion === reg.id ? 'active' : ''}`}
                  onClick={() => setSelectedRegion(reg.id)}
                >
                  {reg.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected Category Detail View */}
        {selectedGenre && (
          <div className="genre-detail-view">
            <button
              onClick={() => setSelectedGenre(null)}
              className="back-link"
            >
              <CaretLeft size={13} weight="bold" />
              <span>Back</span>
            </button>

            <div className="genre-detail-banner">
              <div className="genre-detail-left">
                <span className="genre-detail-kicker">Genre</span>
                <h1 className="genre-detail-title">{selectedGenre.name}</h1>
                <span className="genre-detail-meta">Popular songs in this style</span>
              </div>

              <div className="genre-detail-actions">
                <button
                  className="btn-primary"
                  onClick={() => handlePlayCategoryAll(false)}
                  disabled={genreTracks.length === 0}
                >
                  <Play size={14} weight="bold" />
                  <span>Play all</span>
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => handlePlayCategoryAll(true)}
                  disabled={genreTracks.length === 0}
                >
                  <Shuffle size={14} weight="bold" />
                  <span>Shuffle</span>
                </button>
              </div>
            </div>

            {genreLoading && (
              <div className="inline-loading">Loading songs…</div>
            )}

            {!genreLoading && genreTracks.length === 0 && (
              <div className="inline-empty">No songs found for this genre right now.</div>
            )}

            {!genreLoading && genreTracks.length > 0 && (
              <div className="genre-tracks-list">
                {genreTracks.map((item, idx) => {
                  const isActive = isItemActive(item.id);
                  const isThisPlaying = isActive && isPlaying;
                  const cleanId = item.id.replace(/^(yt:|yt_)/, '');

                  return (
                    <div
                      key={item.id + idx}
                      className={`library-row ${isActive ? 'is-active' : ''}`}
                      onClick={() => handlePlayTrack(item, genreTracks, idx)}
                      onMouseEnter={() => prefetchTrackOnHover(ytItemToTrack(item))}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          item,
                          index: idx
                        });
                      }}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '40px minmax(220px, 2fr) minmax(160px, 1.5fr) 140px',
                        gap: '16px',
                        height: '56px',
                        alignItems: 'center',
                        padding: '0 16px',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer'
                      }}
                    >
                      <div className="track-index-box">
                        <span className="track-index-num">
                          {isThisPlaying ? '▶' : idx + 1}
                        </span>
                        <button
                          className="track-play-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayTrack(item, genreTracks, idx);
                          }}
                        >
                          {isThisPlaying ? <Pause size={13} weight="regular" /> : <Play size={13} weight="regular" />}
                        </button>
                      </div>

                      <div className="track-title-block">
                        <div className="track-thumb">
                          {item.thumbnail_url ? (
                            <img
                              src={getHighResThumbnail(item.thumbnail_url) || ''}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              onError={handleThumbnailError}
                            />
                          ) : (
                            <Disc size={16} />
                          )}
                        </div>
                        <div className="track-title-text" title={item.title}>
                          {item.title}
                        </div>
                      </div>

                      <div className="track-artist-text" title={item.artist}>
                        {item.artist}
                      </div>

                      <div className="online-playlist-actions-cell">
                        <button
                          className="btn-icon"
                          style={{ width: 28, height: 28 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            addToQueue(ytItemToTrack(item));
                          }}
                          title="Add to queue"
                        >
                          <Plus size={14} />
                        </button>

                        <button
                          className="btn-icon"
                          style={{ width: 28, height: 28 }}
                          onClick={(e) => handleDownloadItem(item, e)}
                          title="Download"
                        >
                          {downloadedIds.has(cleanId) ? <Check size={14} color="var(--accent)" /> : <DownloadSimple size={14} />}
                        </button>

                        <span className="online-track-duration">
                          {formatDurationSecs(item.duration_secs)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ===================== TAB 1: MOODS AND GENRES ===================== */}
        {activeTab === 'moods' && !selectedGenre && (
          <div className="moods-genres-section">
            <div className="moods-genres-grid">
              {MOODS_AND_GENRES.map((genre) => (
                <div
                  key={genre.id}
                  className="mood-genre-card"
                  onClick={() => handleSelectGenre(genre)}
                >
                  <div className="mood-genre-text-col">
                    <span className="mood-genre-name">{genre.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===================== TAB 3: GLOBAL TRENDING & CHARTS ===================== */}
        {activeTab === 'trending' && !selectedGenre && (
          <>
            {/* Loading Skeletons */}
            {loading && (
              <div className="explore-loading-skeleton">
                <div className="skeleton-hero shimmer-pulse" />
                {[1, 2, 3].map((sec) => (
                  <div key={sec} className="skeleton-section">
                    <div className="skeleton-section-title shimmer-pulse" />
                    <div className="skeleton-cards-row">
                      {[1, 2, 3, 4, 5, 6].map((c) => (
                        <div key={c} className="skeleton-card">
                          <div className="skeleton-card-thumb shimmer-pulse" />
                          <div className="skeleton-card-text shimmer-pulse" />
                          <div className="skeleton-card-subtext shimmer-pulse" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && !error && activeTab === 'trending' && globalTrendingTracks.length === 0 && !exploreData?.sections?.some((section) => section.items.length > 0) && (
              <div className="explore-empty">
                <p>Nothing here yet. Try another region or retry in a moment.</p>
                <button className="btn-secondary" onClick={() => fetchExplore(selectedRegion, true)}>
                  <ArrowsClockwise size={15} />
                  Retry
                </button>
              </div>
            )}

            {!loading && error && (
              <div className="explore-error-card">
                <div className="explore-error-icon">
                  <Compass size={40} weight="regular" color="var(--text-tertiary)" />
                </div>
                <h3 className="explore-error-title">Couldn't load Explore</h3>
                <p className="explore-error-msg">{error}</p>
                <button
                  className="btn-primary"
                  onClick={() => fetchExplore(selectedRegion, true)}
                  style={{ marginTop: '16px' }}
                >
                  <ArrowsClockwise size={15} />
                  <span>Retry</span>
                </button>
              </div>
            )}

            {!loading && !error && (
              <>
                {/* 2. Hero Highlights Banner */}
                {activeHeroItem && (
                  <div
                    className="explore-hero-wrapper"
                    onMouseEnter={() => setIsHeroPaused(true)}
                    onMouseLeave={() => setIsHeroPaused(false)}
                  >
                    <div
                      className="explore-hero-glow"
                      style={{
                        backgroundImage: activeHeroItem.thumbnail_url
                          ? `url(${getHighResThumbnail(activeHeroItem.thumbnail_url)})`
                          : 'none'
                      }}
                    />

                    <div className="explore-hero-card">
                      <div className="explore-hero-body">
                        <div className="explore-hero-badge">
                          <ChartLineUp size={13} />
                          <span>Trending</span>
                        </div>

                        <h1 className="explore-hero-title" title={activeHeroItem.title}>
                          {activeHeroItem.title}
                        </h1>

                        <p className="explore-hero-artist" title={activeHeroItem.artist}>
                          {activeHeroItem.artist}
                        </p>

                        <div className="explore-hero-meta">
                          <span>Trending now</span>
                          {activeHeroItem.duration_secs > 0 && <span aria-hidden="true">·</span>}
                          {activeHeroItem.duration_secs > 0 && (
                            <span>{formatDurationSecs(activeHeroItem.duration_secs)}</span>
                          )}
                        </div>

                        <div className="explore-hero-actions">
                          <button
                            className="btn-primary explore-hero-play-btn"
                            onClick={() => handlePlayTrack(activeHeroItem, heroItems, heroIndex)}
                          >
                            {isItemActive(activeHeroItem.id) && isPlaying ? (
                              <>
                                <Pause size={16} weight="regular" />
                                <span>Pause</span>
                              </>
                            ) : (
                              <>
                                <Play size={16} weight="regular" />
                                <span>Play</span>
                              </>
                            )}
                          </button>

                          <button
                            className="btn-secondary"
                            onClick={() => addToQueue(ytItemToTrack(activeHeroItem))}
                            title="Play next"
                          >
                            <Plus size={16} />
                            <span>Play next</span>
                          </button>

                          <button
                            className="btn-secondary"
                            onClick={(e) => handleDownloadItem(activeHeroItem, e)}
                            title="Download to your library"
                          >
                            {downloadedIds.has(activeHeroItem.id.replace(/^(yt:|yt_)/, '')) ? (
                              <>
                                <Check size={16} color="var(--accent)" />
                                <span>Queued</span>
                              </>
                            ) : (
                              <>
                                <DownloadSimple size={16} />
                                <span>Download</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="explore-hero-artwork-box">
                        {activeHeroItem.thumbnail_url ? (
                          <img
                            src={getHighResThumbnail(activeHeroItem.thumbnail_url) || ''}
                            alt={activeHeroItem.title}
                            className="explore-hero-artwork"
                            loading="eager"
                            decoding="async"
                            onError={handleThumbnailError}
                          />
                        ) : (
                          <div className="explore-hero-artwork-fallback">
                            <Disc size={64} color="var(--text-tertiary)" />
                          </div>
                        )}
                      </div>
                    </div>

                    {heroItems.length > 1 && (
                      <div className="explore-hero-dots">
                        {heroItems.map((_, dotIdx) => (
                          <button
                            key={dotIdx}
                            className={`explore-hero-dot ${dotIdx === heroIndex ? 'active' : ''}`}
                            onClick={() => setHeroIndex(dotIdx)}
                            aria-label={`Go to highlight ${dotIdx + 1}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Global Trending Hits Carousel */}
                {globalTrendingTracks.length > 0 && (
                  <div className="explore-section">
                    <div className="explore-section-header">
                      <div className="explore-section-title-wrap">
                        <h3 className="explore-section-title">Popular songs</h3>
                        <span className="explore-section-count">
                          {globalTrendingTracks.length} tracks
                        </span>
                      </div>

                      <div className="explore-carousel-controls">
                        <button
                          className="carousel-arrow-btn"
                          onClick={() => scrollCarousel(999, -1)}
                          title="Scroll left"
                        >
                          <CaretLeft size={16} weight="regular" />
                        </button>
                        <button
                          className="carousel-arrow-btn"
                          onClick={() => scrollCarousel(999, 1)}
                          title="Scroll right"
                        >
                          <CaretRight size={16} weight="regular" />
                        </button>
                      </div>
                    </div>

                    <div
                      ref={(el) => {
                        carouselRefs.current[999] = el;
                      }}
                      className="explore-carousel-track hide-scrollbar"
                    >
                      {globalTrendingTracks.map((item, itemIdx) => {
                        const isActive = isItemActive(item.id);
                        const isThisPlaying = isActive && isPlaying;
                        const cleanId = item.id.replace(/^(yt:|yt_)/, '');

                        return (
                          <div
                            key={item.id + itemIdx}
                            className={`explore-card ${isActive ? 'is-active' : ''}`}
                            onClick={() => handlePlayTrack(item, globalTrendingTracks, itemIdx)}
                            onMouseEnter={() => prefetchTrackOnHover(ytItemToTrack(item))}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                item,
                                index: itemIdx
                              });
                            }}
                          >
                            <div className="explore-card-thumb">
                              {item.thumbnail_url ? (
                                <img
                                  src={getHighResThumbnail(item.thumbnail_url) || ''}
                                  alt={item.title}
                                  loading="lazy"
                                  decoding="async"
                                  onError={handleThumbnailError}
                                />
                              ) : (
                                <div className="explore-card-thumb-fallback">
                                  <Disc size={36} color="var(--text-tertiary)" />
                                </div>
                              )}

                              <div className="explore-card-overlay">
                                <button
                                  className="explore-card-play-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePlayTrack(item, globalTrendingTracks, itemIdx);
                                  }}
                                  title={isThisPlaying ? 'Pause' : 'Play'}
                                >
                                  {isThisPlaying ? <Pause size={22} weight="regular" /> : <Play size={22} weight="regular" />}
                                </button>

                                <div className="explore-card-quick-actions">
                                  <button
                                    className="explore-card-action-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      addToQueue(ytItemToTrack(item));
                                    }}
                                    title="Add to queue"
                                  >
                                    <Plus size={14} weight="regular" />
                                  </button>

                                  <button
                                    className="explore-card-action-btn"
                                    onClick={(e) => handleDownloadItem(item, e)}
                                    title="Download"
                                  >
                                    {downloadedIds.has(cleanId) ? (
                                      <Check size={14} weight="regular" color="var(--accent)" />
                                    ) : (
                                      <DownloadSimple size={14} weight="regular" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {item.duration_secs > 0 && (
                                <span className="explore-card-duration">
                                  {formatDurationSecs(item.duration_secs)}
                                </span>
                              )}
                            </div>

                            <div className="explore-card-info">
                              <div className="explore-card-title" title={item.title}>
                                {item.title}
                              </div>
                              <div className="explore-card-artist" title={item.artist}>
                                {item.artist || 'Unknown artist'}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 4. Additional Sections */}
                {exploreData?.sections &&
                  exploreData.sections.map((section, sIdx) => {
                    if (!section.items || section.items.length === 0) return null;

                    return (
                      <div key={section.title + sIdx} className="explore-section">
                        <div className="explore-section-header">
                          <div className="explore-section-title-wrap">
                            <h3 className="explore-section-title">{section.title}</h3>
                            <span className="explore-section-count">
                              {section.items.length} tracks
                            </span>
                          </div>

                          <div className="explore-carousel-controls">
                            <button
                              className="carousel-arrow-btn"
                              onClick={() => scrollCarousel(sIdx, -1)}
                              title="Scroll left"
                            >
                              <CaretLeft size={16} weight="regular" />
                            </button>
                            <button
                              className="carousel-arrow-btn"
                              onClick={() => scrollCarousel(sIdx, 1)}
                              title="Scroll right"
                            >
                              <CaretRight size={16} weight="regular" />
                            </button>
                          </div>
                        </div>

                        <div
                          ref={(el) => {
                            carouselRefs.current[sIdx] = el;
                          }}
                          className="explore-carousel-track hide-scrollbar"
                        >
                          {section.items.map((item, itemIdx) => {
                            const isActive = isItemActive(item.id);
                            const isThisPlaying = isActive && isPlaying;
                            const cleanId = item.id.replace(/^(yt:|yt_)/, '');

                            return (
                              <div
                                key={item.id + itemIdx}
                                className={`explore-card ${isActive ? 'is-active' : ''}`}
                                onClick={() => handlePlayTrack(item, section.items, itemIdx)}
                                onMouseEnter={() => prefetchTrackOnHover(ytItemToTrack(item))}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setContextMenu({
                                    x: e.clientX,
                                    y: e.clientY,
                                    item,
                                    section,
                                    index: itemIdx
                                  });
                                }}
                              >
                                <div className="explore-card-thumb">
                                  {item.thumbnail_url ? (
                                    <img
                                      src={getHighResThumbnail(item.thumbnail_url) || ''}
                                      alt={item.title}
                                      loading="lazy"
                                      decoding="async"
                                      onError={handleThumbnailError}
                                    />
                                  ) : (
                                    <div className="explore-card-thumb-fallback">
                                      <Disc size={36} color="var(--text-tertiary)" />
                                    </div>
                                  )}

                                  <div className="explore-card-overlay">
                                    <button
                                      className="explore-card-play-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePlayTrack(item, section.items, itemIdx);
                                      }}
                                      title={isThisPlaying ? 'Pause' : 'Play'}
                                    >
                                      {isThisPlaying ? <Pause size={22} weight="regular" /> : <Play size={22} weight="regular" />}
                                    </button>

                                    <div className="explore-card-quick-actions">
                                      <button
                                        className="explore-card-action-btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          addToQueue(ytItemToTrack(item));
                                        }}
                                        title="Add to queue"
                                      >
                                        <Plus size={14} weight="regular" />
                                      </button>

                                      <button
                                        className="explore-card-action-btn"
                                        onClick={(e) => handleDownloadItem(item, e)}
                                        title="Download"
                                      >
                                        {downloadedIds.has(cleanId) ? (
                                          <Check size={14} weight="regular" color="var(--accent)" />
                                        ) : (
                                          <DownloadSimple size={14} weight="regular" />
                                        )}
                                      </button>
                                    </div>
                                  </div>

                                  {item.duration_secs > 0 && (
                                    <span className="explore-card-duration">
                                      {formatDurationSecs(item.duration_secs)}
                                    </span>
                                  )}
                                </div>

                                <div className="explore-card-info">
                                  <div className="explore-card-title" title={item.title}>
                                    {item.title}
                                  </div>
                                  <div className="explore-card-artist" title={item.artist}>
                                    {item.artist || 'Unknown artist'}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </>
            )}
          </>
        )}
      </div>

      {/* Right click Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={getContextMenuItems()}
        />
      )}
    </div>
  );
}
