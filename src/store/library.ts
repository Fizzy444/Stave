import { create } from 'zustand';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { listen } from '@tauri-apps/api/event';
import { getHighResThumbnail } from '../utils/thumbnail';

export type TrackId = number | string;

export interface Track<TId extends number | string = any> {
    id: TId;
    path: string;
    title: string | null;
    artist: string | null;
    album_artist: string | null;
    album: string | null;
    track_no: number | null;
    disc_no: number | null;
    duration_ms: number | null;
    art_hash: string | null;
    accent: string | null;
    mtime: number | null;
    play_count: number | null;
    last_played: number | null;
    favorite: boolean;
    source?: 'local' | 'youtube';
    youtube_id?: string;
}

interface LibraryState {
    tracks: Track[];
    isScanning: boolean;
    artworkPath: string | null;
    initArtworkPath: () => Promise<void>;
    loadTracks: () => Promise<void>;
    scanFolder: (path: string) => Promise<void>;
    rescanLibrary: () => Promise<void>;
    toggleFavorite: (trackId: number | string, favorite: boolean) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set) => ({
    tracks: [],
    isScanning: false,
    artworkPath: null,
    
    initArtworkPath: async () => {
        try {
            const dir = await appDataDir();
            // path.join would be better, but simple append works if we normalize
            const sep = dir.includes('\\') ? '\\' : '/';
            set({ artworkPath: dir + (dir.endsWith(sep) ? '' : sep) + 'artwork' + sep });
        } catch (e) {
            console.error(e);
        }
    },

    loadTracks: async () => {
        try {
            const tracks = await invoke<Track[]>('get_tracks');
            set({ tracks });
        } catch (e) {
            console.error("Failed to load tracks", e);
        }
    },

    scanFolder: async (path: string) => {
        set({ isScanning: true });
        try {
            await invoke('scan_library', { path });
        } catch (e) {
            console.error("Failed to scan folder", e);
        } finally {
            try {
                const tracks = await invoke<Track[]>('get_tracks');
                set({ tracks, isScanning: false });
            } catch (err) {
                console.error("Failed to load tracks after scan", err);
                set({ isScanning: false });
            }
        }
    },
    
    rescanLibrary: async () => {
        set({ isScanning: true });
        try {
            await invoke('rescan_library');
        } catch (e) {
            console.error("Failed to rescan library", e);
        } finally {
            try {
                const tracks = await invoke<Track[]>('get_tracks');
                set({ tracks, isScanning: false });
            } catch (err) {
                console.error("Failed to load tracks after rescan", err);
                set({ isScanning: false });
            }
        }
    },
    
    toggleFavorite: async (trackId: number | string, favorite: boolean) => {
        try {
            if (typeof trackId === 'number') {
                await invoke('toggle_favorite', { trackId, favorite });
            }
            // Update local state optimistically
            set((state) => ({
                tracks: state.tracks.map(t => t.id === trackId ? { ...t, favorite } : t)
            }));
        } catch (e) {
            console.error("Failed to toggle favorite", e);
        }
    }
}));

const artworkCache = new Map<string, string>();

export const getArtworkUrl = (hash: string | null) => {
    if (!hash) return null;
    if (hash.startsWith('http://') || hash.startsWith('https://')) {
        return getHighResThumbnail(hash) || hash;
    }
    if (artworkCache.has(hash)) return artworkCache.get(hash)!;
    
    const store = useLibraryStore.getState();
    if (!store.artworkPath) return null;
    
    const url = convertFileSrc(`${store.artworkPath}${hash}_800.webp`);
    artworkCache.set(hash, url);
    return url;
};

// Listen for incremental scan updates so tracks appear progressively in real time
let libraryUpdateTimer: number | undefined;
if (typeof window !== 'undefined') {
    listen('library:updated', () => {
        if (libraryUpdateTimer) clearTimeout(libraryUpdateTimer);
        libraryUpdateTimer = window.setTimeout(async () => {
            try {
                const tracks = await invoke<Track[]>('get_tracks');
                useLibraryStore.setState({ tracks });
            } catch (e) {
                console.error("Failed to load tracks on library:updated", e);
            }
        }, 150);
    }).catch(console.error);
}
