import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Track } from './library';

interface SearchState {
    query: string;
    results: Track[];
    isSearching: boolean;
    setQuery: (q: string) => void;
}

let searchTimeout: ReturnType<typeof setTimeout>;

export const useSearchStore = create<SearchState>((set) => ({
    query: '',
    results: [],
    isSearching: false,
    
    setQuery: (q: string) => {
        set({ query: q, isSearching: true });
        
        clearTimeout(searchTimeout);
        if (!q.trim()) {
            set({ results: [], isSearching: false });
            return;
        }

        searchTimeout = setTimeout(async () => {
            try {
                const results = await invoke<Track[]>('search_tracks', { query: q });
                set({ results, isSearching: false });
            } catch (e) {
                console.error(e);
                set({ isSearching: false });
            }
        }, 300); // 300ms debounce
    }
}));
