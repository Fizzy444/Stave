import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Track } from './library';
import { parseLrc, LyricLine } from '../lyrics/parseLrc';
import { extractYouTubeId } from './player';

export interface LyricsProvider {
  id: string;
  name: string;
}

export const LYRICS_PROVIDERS: LyricsProvider[] = [
  { id: 'lrc.red', name: 'lrc.red' },
  { id: 'BiniLyrics', name: 'BiniLyrics' },
  { id: 'BetterLyrics', name: 'BetterLyrics' },
  { id: 'BetterLyrics Portato', name: 'BetterLyrics Portato' },
  { id: 'PaxSenix', name: 'PaxSenix' },
  { id: 'PaxSenix: Spotify', name: 'PaxSenix: Spotify' },
  { id: 'PaxSenix: Musixmatch', name: 'PaxSenix: Musixmatch' },
  { id: 'LyricsPlus', name: 'LyricsPlus' },
  { id: 'Unison', name: 'Unison' },
  { id: 'YouTube captions', name: 'YouTube captions' },
  { id: 'YouTube Music', name: 'YouTube Music' },
];

export type ProviderStatusType = 'idle' | 'loading' | 'found' | 'not_found';

export interface ProviderStatus {
  status: ProviderStatusType;
  synced?: string | null;
  plain?: string | null;
}

interface LyricsResponse {
  synced: string | null;
  plain: string | null;
  source: string;
}

interface LyricsState {
  currentProvider: string;
  providerStatuses: Record<string, ProviderStatus>;
  lyrics: LyricLine[] | null;
  plainText: string | null;
  isLoading: boolean;
  activeTrackKey: string | null;
  activeTrack: Track | null;
  offsetMs: number;
  isModalOpen: boolean;

  setOffsetMs: (updater: number | ((prev: number) => number)) => void;
  openModal: () => void;
  closeModal: () => void;
  fetchForTrack: (track: Track | null) => Promise<void>;
  fetchProvider: (providerId: string, track?: Track | null) => Promise<void>;
  selectProvider: (providerId: string) => void;
}

export function getTrackKey(track: Track | null): string | null {
  if (!track) return null;
  const vid = extractYouTubeId(track);
  if (vid) return `yt_${vid}`;
  if (track.id != null && track.id !== 0 && track.id !== '0') return String(track.id);
  if (track.path) return String(track.path);
  return `${track.title || ''}_${track.artist || ''}`;
}

export const useLyricsStore = create<LyricsState>((set, get) => ({
  currentProvider: 'lrc.red',
  providerStatuses: {},
  lyrics: null,
  plainText: null,
  isLoading: false,
  activeTrackKey: null,
  activeTrack: null,
  offsetMs: 0,
  isModalOpen: false,

  setOffsetMs: (updater) => {
    set((state) => ({
      offsetMs: typeof updater === 'function' ? updater(state.offsetMs) : updater,
    }));
  },

  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),

  fetchForTrack: async (track) => {
    if (!track) {
      set({
        lyrics: null,
        plainText: null,
        isLoading: false,
        activeTrackKey: null,
        activeTrack: null,
        providerStatuses: {},
        offsetMs: 0,
      });
      return;
    }

    const trackKey = getTrackKey(track);
    const state = get();
    if (state.activeTrackKey === trackKey && (state.lyrics || state.plainText)) {
      return; // Already loaded for current track
    }

    set({
      isLoading: true,
      lyrics: null,
      plainText: null,
      activeTrackKey: trackKey,
      activeTrack: track,
      providerStatuses: {},
      offsetMs: 0,
    });

    const chosenProvider = state.currentProvider || 'lrc.red';
    const videoId = extractYouTubeId(track);

    try {
      const res = await invoke<LyricsResponse>('fetch_lyrics_from_provider', {
        trackId: trackKey,
        provider: chosenProvider,
        title: track.title || '',
        artist: track.artist || '',
        album: track.album || '',
        durationMs: track.duration_ms || 0,
        videoId: videoId || undefined,
      });

      // Verify still active track
      if (get().activeTrackKey !== trackKey) return;

      const syncedLines = res.synced ? parseLrc(res.synced) : null;
      set((s) => ({
        isLoading: false,
        lyrics: syncedLines,
        plainText: res.plain || null,
        providerStatuses: {
          ...s.providerStatuses,
          [chosenProvider]: {
            status: 'found',
            synced: res.synced,
            plain: res.plain,
          },
        },
      }));
    } catch (err) {
      if (get().activeTrackKey !== trackKey) return;

      set((s) => ({
        isLoading: false,
        providerStatuses: {
          ...s.providerStatuses,
          [chosenProvider]: { status: 'not_found' },
        },
      }));
    }
  },

  fetchProvider: async (providerId, overrideTrack) => {
    const track = overrideTrack || get().activeTrack;
    if (!track) return;

    const trackKey = getTrackKey(track);
    const videoId = extractYouTubeId(track);

    set((s) => ({
      providerStatuses: {
        ...s.providerStatuses,
        [providerId]: { status: 'loading' },
      },
    }));

    try {
      const res = await invoke<LyricsResponse>('fetch_lyrics_from_provider', {
        trackId: trackKey,
        provider: providerId,
        title: track.title || '',
        artist: track.artist || '',
        album: track.album || '',
        durationMs: track.duration_ms || 0,
        videoId: videoId || undefined,
      });

      if (get().activeTrackKey !== trackKey) return;

      const syncedLines = res.synced ? parseLrc(res.synced) : null;

      // Automatically make it the current provider
      set((s) => ({
        currentProvider: providerId,
        lyrics: syncedLines,
        plainText: res.plain || null,
        providerStatuses: {
          ...s.providerStatuses,
          [providerId]: {
            status: 'found',
            synced: res.synced,
            plain: res.plain,
          },
        },
      }));
    } catch {
      if (get().activeTrackKey !== trackKey) return;

      set((s) => ({
        providerStatuses: {
          ...s.providerStatuses,
          [providerId]: { status: 'not_found' },
        },
      }));
    }
  },

  selectProvider: (providerId) => {
    const state = get();
    const cached = state.providerStatuses[providerId];

    if (cached && cached.status === 'found') {
      const syncedLines = cached.synced ? parseLrc(cached.synced) : null;
      set({
        currentProvider: providerId,
        lyrics: syncedLines,
        plainText: cached.plain || null,
      });
    } else {
      set({ currentProvider: providerId });
      if (state.activeTrack) {
        state.fetchProvider(providerId, state.activeTrack);
      }
    }
  },
}));
