import { create } from 'zustand';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';

export interface Track {
    id: number;
    path: string;
    title: string | null;
    artist: string | null;
    album: string | null;
    duration_ms: number | null;
    art_hash: string | null;
    accent: string | null;
    mtime: number | null;
    play_count: number | null;
    last_played: number | null;
    favorite: boolean;
}

interface LibraryState {
    tracks: Track[];
    isScanning: boolean;
    artworkPath: string | null;
    initArtworkPath: () => Promise<void>;
    loadTracks: () => Promise<void>;
    scanFolder: (path: string) => Promise<void>;
    toggleFavorite: (trackId: number, favorite: boolean) => Promise<void>;
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
            const tracks = await invoke<Track[]>('get_tracks');
            set({ tracks, isScanning: false });
        } catch (e) {
            console.error("Failed to scan folder", e);
            set({ isScanning: false });
        }
    },
    
    toggleFavorite: async (trackId: number, favorite: boolean) => {
        try {
            await invoke('toggle_favorite', { trackId, favorite });
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
    if (artworkCache.has(hash)) return artworkCache.get(hash)!;
    
    const store = useLibraryStore.getState();
    if (!store.artworkPath) return null;
    
    const url = convertFileSrc(`${store.artworkPath}${hash}_300.webp`);
    artworkCache.set(hash, url);
    return url;
};
