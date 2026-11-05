import { create } from 'zustand';
import {
  YTExploreData,
  YTTrackItem,
  YTLibraryPlaylist,
  YTPlaylistDetails,
  getYouTubeExplore,
  searchYouTube,
  getYouTubeAccountPlaylists,
  getYouTubePlaylist,
  ytItemToTrack
} from './ytmusic';
import { prefetchTracks } from './player';

export interface MetaCache<T> {
  data: T | null;
  ts: number;
  loading: boolean;
  error: string | null;
}

export interface ExploreCacheData {
  exploreData: YTExploreData | null;
  trending: YTTrackItem[];
}

export interface MetadataState {
  explore: Record<string, MetaCache<ExploreCacheData>>;
  search: Record<string, MetaCache<YTTrackItem[]>>;
  playlists: MetaCache<YTLibraryPlaylist[]>;
  playlistDetails: Record<string, MetaCache<YTPlaylistDetails>>;

  fetchExplore: (region?: string, force?: boolean) => Promise<ExploreCacheData | null>;
  fetchSearch: (query: string, filter?: string, force?: boolean) => Promise<YTTrackItem[] | null>;
  fetchAccountPlaylists: (force?: boolean) => Promise<YTLibraryPlaylist[] | null>;
  fetchPlaylistDetails: (playlistId: string, force?: boolean) => Promise<YTPlaylistDetails | null>;
  clearSearch: () => void;
}

const EXPLORE_TTL = 120 * 1000; // 120s
const SEARCH_TTL = 120 * 1000; // 120s
const PLAYLISTS_TTL = 60 * 1000; // 60s
const DETAILS_TTL = 300 * 1000; // 300s

const inflightExplore = new Map<string, Promise<ExploreCacheData | null>>();
const inflightSearch = new Map<string, Promise<YTTrackItem[] | null>>();
let inflightPlaylists: Promise<YTLibraryPlaylist[] | null> | null = null;
const inflightDetails = new Map<string, Promise<YTPlaylistDetails | null>>();

export const useMetadataStore = create<MetadataState>((set, get) => ({
  explore: {},
  search: {},
  playlists: {
    data: null,
    ts: 0,
    loading: false,
    error: null,
  },
  playlistDetails: {},

  fetchExplore: async (region: string = 'global', force: boolean = false) => {
    const existing = get().explore[region];
    const now = Date.now();

    // 1. Fresh cache hit -> return immediately without any fetch or loading state
    if (!force && existing?.data && (now - existing.ts < EXPLORE_TTL)) {
      return existing.data;
    }

    // 2. Stale cache hit -> return cached data immediately and revalidate in background
    if (!force && existing?.data) {
      if (!inflightExplore.has(region)) {
        const bgPromise = (async () => {
          try {
            const query = region === 'us' ? 'popular US songs'
              : region === 'uk' ? 'popular UK songs'
              : region === 'japan' ? 'popular Japanese songs'
              : 'popular global songs';
            const [globalResult, exploreResult] = await Promise.allSettled([
              searchYouTube(query, 'songs'),
              getYouTubeExplore()
            ]);
            const trending = globalResult.status === 'fulfilled' ? (globalResult.value || []) : (existing.data?.trending || []);
            const exploreData = exploreResult.status === 'fulfilled' ? exploreResult.value : (existing.data?.exploreData || null);
            const data: ExploreCacheData = { exploreData, trending };

            set((state) => ({
              explore: {
                ...state.explore,
                [region]: { data, ts: Date.now(), loading: false, error: null }
              }
            }));

            if (trending.length > 0) {
              prefetchTracks(trending.slice(0, 3).map(ytItemToTrack), 3);
            }
            return data;
          } catch (err) {
            console.warn('Background explore revalidate error:', err);
            return existing.data;
          } finally {
            inflightExplore.delete(region);
          }
        })();
        inflightExplore.set(region, bgPromise);
      }
      return existing.data;
    }

    // 3. Cold fetch or forced refresh
    if (inflightExplore.has(region)) {
      return inflightExplore.get(region)!;
    }

    set((state) => ({
      explore: {
        ...state.explore,
        [region]: {
          data: existing?.data || null,
          ts: existing?.ts || 0,
          loading: !existing?.data,
          error: null
        }
      }
    }));

    const promise = (async () => {
      try {
        const query = region === 'us' ? 'popular US songs'
          : region === 'uk' ? 'popular UK songs'
          : region === 'japan' ? 'popular Japanese songs'
          : 'popular global songs';
        const [globalResult, exploreResult] = await Promise.allSettled([
          searchYouTube(query, 'songs'),
          getYouTubeExplore()
        ]);

        const trending = globalResult.status === 'fulfilled' ? (globalResult.value || []) : [];
        const exploreData = exploreResult.status === 'fulfilled' ? exploreResult.value : null;

        if (globalResult.status === 'rejected' && exploreResult.status === 'rejected') {
          throw exploreResult.reason || globalResult.reason || new Error('Failed to load explore feed');
        }

        const data: ExploreCacheData = { exploreData, trending };
        set((state) => ({
          explore: {
            ...state.explore,
            [region]: { data, ts: Date.now(), loading: false, error: null }
          }
        }));

        if (trending.length > 0) {
          prefetchTracks(trending.slice(0, 3).map(ytItemToTrack), 3);
        }
        return data;
      } catch (err: any) {
        const errMsg = typeof err === 'string' ? err : err?.message || 'Failed to load explore content';
        set((state) => ({
          explore: {
            ...state.explore,
            [region]: {
              data: state.explore[region]?.data || null,
              ts: state.explore[region]?.ts || 0,
              loading: false,
              error: errMsg
            }
          }
        }));
        return null;
      } finally {
        inflightExplore.delete(region);
      }
    })();

    inflightExplore.set(region, promise);
    return promise;
  },

  fetchSearch: async (query: string, filter?: string, force: boolean = false) => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return null;

    const normalizedFilter = filter === 'all' || !filter ? '' : filter;
    const key = `${trimmed}|${normalizedFilter}`;
    const existing = get().search[key];
    const now = Date.now();

    if (!force && existing?.data && (now - existing.ts < SEARCH_TTL)) {
      return existing.data;
    }

    if (!force && existing?.data) {
      if (!inflightSearch.has(key)) {
        const bgPromise = (async () => {
          try {
            const filterParam = normalizedFilter || undefined;
            const items = await searchYouTube(query.trim(), filterParam);
            set((state) => ({
              search: {
                ...state.search,
                [key]: { data: items, ts: Date.now(), loading: false, error: null }
              }
            }));
            if (items.length > 0) {
              prefetchTracks(items.slice(0, 3).map(ytItemToTrack), 3);
            }
            return items;
          } catch {
            return existing.data;
          } finally {
            inflightSearch.delete(key);
          }
        })();
        inflightSearch.set(key, bgPromise);
      }
      return existing.data;
    }

    if (inflightSearch.has(key)) {
      return inflightSearch.get(key)!;
    }

    set((state) => ({
      search: {
        ...state.search,
        [key]: {
          data: existing?.data || null,
          ts: existing?.ts || 0,
          loading: !existing?.data,
          error: null
        }
      }
    }));

    const promise = (async () => {
      try {
        const filterParam = normalizedFilter || undefined;
        const items = await searchYouTube(query.trim(), filterParam);
        set((state) => ({
          search: {
            ...state.search,
            [key]: { data: items, ts: Date.now(), loading: false, error: null }
          }
        }));
        if (items.length > 0) {
          prefetchTracks(items.slice(0, 3).map(ytItemToTrack), 3);
        }
        return items;
      } catch (err: any) {
        const errMsg = typeof err === 'string' ? err : err?.message || 'Search failed';
        set((state) => ({
          search: {
            ...state.search,
            [key]: {
              data: state.search[key]?.data || null,
              ts: state.search[key]?.ts || 0,
              loading: false,
              error: errMsg
            }
          }
        }));
        return null;
      } finally {
        inflightSearch.delete(key);
      }
    })();

    inflightSearch.set(key, promise);
    return promise;
  },

  fetchAccountPlaylists: async (force: boolean = false) => {
    const existing = get().playlists;
    const now = Date.now();

    if (!force && existing.data && (now - existing.ts < PLAYLISTS_TTL)) {
      return existing.data;
    }

    if (!force && existing.data) {
      if (!inflightPlaylists) {
        inflightPlaylists = (async () => {
          try {
            const items = await getYouTubeAccountPlaylists();
            set({
              playlists: { data: items, ts: Date.now(), loading: false, error: null }
            });
            return items;
          } catch {
            return existing.data;
          } finally {
            inflightPlaylists = null;
          }
        })();
      }
      return existing.data;
    }

    if (inflightPlaylists) {
      return inflightPlaylists;
    }

    set((state) => ({
      playlists: {
        ...state.playlists,
        loading: !existing.data,
        error: null
      }
    }));

    inflightPlaylists = (async () => {
      try {
        const items = await getYouTubeAccountPlaylists();
        set({
          playlists: { data: items, ts: Date.now(), loading: false, error: null }
        });
        return items;
      } catch (err: any) {
        const errMsg = typeof err === 'string' ? err : err?.message || 'Failed to load playlists';
        set((state) => ({
          playlists: {
            ...state.playlists,
            loading: false,
            error: errMsg
          }
        }));
        return null;
      } finally {
        inflightPlaylists = null;
      }
    })();

    return inflightPlaylists;
  },

  fetchPlaylistDetails: async (playlistId: string, force: boolean = false) => {
    const cleanId = playlistId.trim().replace(/^(yt:|yt_)/, '');
    if (!cleanId) return null;

    const existing = get().playlistDetails[cleanId];
    const now = Date.now();

    if (!force && existing?.data && (now - existing.ts < DETAILS_TTL)) {
      return existing.data;
    }

    if (!force && existing?.data) {
      if (!inflightDetails.has(cleanId)) {
        const bgPromise = (async () => {
          try {
            const details = await getYouTubePlaylist(cleanId);
            set((state) => ({
              playlistDetails: {
                ...state.playlistDetails,
                [cleanId]: { data: details, ts: Date.now(), loading: false, error: null }
              }
            }));
            if (details.tracks.length > 0) {
              prefetchTracks(details.tracks.slice(0, 3).map(ytItemToTrack), 3);
            }
            return details;
          } catch {
            return existing.data;
          } finally {
            inflightDetails.delete(cleanId);
          }
        })();
        inflightDetails.set(cleanId, bgPromise);
      }
      return existing.data;
    }

    if (inflightDetails.has(cleanId)) {
      return inflightDetails.get(cleanId)!;
    }

    set((state) => ({
      playlistDetails: {
        ...state.playlistDetails,
        [cleanId]: {
          data: existing?.data || null,
          ts: existing?.ts || 0,
          loading: !existing?.data,
          error: null
        }
      }
    }));

    const promise = (async () => {
      try {
        const details = await getYouTubePlaylist(cleanId);
        set((state) => ({
          playlistDetails: {
            ...state.playlistDetails,
            [cleanId]: { data: details, ts: Date.now(), loading: false, error: null }
          }
        }));
        if (details.tracks.length > 0) {
          prefetchTracks(details.tracks.slice(0, 3).map(ytItemToTrack), 3);
        }
        return details;
      } catch (err: any) {
        const errMsg = typeof err === 'string' ? err : err?.message || 'Failed to load playlist';
        set((state) => ({
          playlistDetails: {
            ...state.playlistDetails,
            [cleanId]: {
              data: state.playlistDetails[cleanId]?.data || null,
              ts: state.playlistDetails[cleanId]?.ts || 0,
              loading: false,
              error: errMsg
            }
          }
        }));
        return null;
      } finally {
        inflightDetails.delete(cleanId);
      }
    })();

    inflightDetails.set(cleanId, promise);
    return promise;
  },

  clearSearch: () => {
    set({ search: {} });
  }
}));
