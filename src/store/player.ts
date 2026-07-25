import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { Track } from './library';
import { engine } from '../audio/engine';

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
    queue: Track[];
    currentIndex: number;
    isPlaying: boolean;
    volume: number;
    isMuted: boolean;
    shuffle: boolean;
    repeat: RepeatMode;
    position: number;
    duration: number;

    play: (track: Track) => void;
    playContext: (tracks: Track[], startIndex: number) => void;
    pause: () => void;
    resume: () => void;
    next: () => void;
    prev: () => void;
    setVolume: (v: number) => void;
    toggleMute: () => void;
    seek: (time: number) => void;
    updatePosition: (time: number, duration: number) => void;
    addToQueue: (track: Track) => void;
    playNext: (track: Track) => void;
    reorderQueue: (startIndex: number, endIndex: number) => void;
    toggleShuffle: () => void;
    toggleRepeat: () => void;
}

export const usePlayerStore = create<PlayerState>()(
    persist(
        (set, get) => ({
            queue: [],
            currentIndex: -1,
            isPlaying: false,
            volume: 1.0,
            isMuted: false,
            shuffle: false,
            repeat: 'off',
            position: 0,
            duration: 0,

            play: (track) => {
                const { queue } = get();
                const idx = queue.findIndex(t => t.id === track.id);
                if (idx >= 0) {
                    set({ currentIndex: idx, isPlaying: true });
                } else {
                    set({ queue: [track], currentIndex: 0, isPlaying: true });
                }
                engine.play(track.path);
                invoke('mark_played', { trackId: track.id }).catch(console.error);
            },
            playContext: (tracks, startIndex) => {
                if (tracks.length === 0 || startIndex < 0 || startIndex >= tracks.length) return;
                set({ queue: tracks, currentIndex: startIndex, isPlaying: true });
                const track = tracks[startIndex];
                engine.play(track.path);
                invoke('mark_played', { trackId: track.id }).catch(console.error);
            },
            pause: () => {
                engine.pause();
                set({ isPlaying: false });
            },
            resume: () => {
                const { queue, currentIndex } = get();
                if (currentIndex >= 0 && queue[currentIndex]) {
                    engine.play(queue[currentIndex].path);
                    set({ isPlaying: true });
                }
            },
            next: () => {
                const { queue, currentIndex, repeat } = get();
                if (queue.length === 0) return;
                
                let nextIdx = currentIndex + 1;
                if (nextIdx >= queue.length) {
                    if (repeat === 'all') {
                        nextIdx = 0;
                    } else {
                        set({ isPlaying: false, position: 0 });
                        return;
                    }
                }
                set({ currentIndex: nextIdx, isPlaying: true, position: 0 });
                engine.play(queue[nextIdx].path);
                invoke('mark_played', { trackId: queue[nextIdx].id }).catch(console.error);
            },
            prev: () => {
                const { queue, currentIndex, position } = get();
                if (queue.length === 0) return;

                if (position > 3) {
                    engine.seek(0);
                    set({ position: 0 });
                    return;
                }

                let prevIdx = currentIndex - 1;
                if (prevIdx < 0) prevIdx = 0;
                set({ currentIndex: prevIdx, isPlaying: true, position: 0 });
                engine.play(queue[prevIdx].path);
                invoke('mark_played', { trackId: queue[prevIdx].id }).catch(console.error);
            },
            setVolume: (v: number) => {
                engine.setVolume(v);
                set({ volume: v, isMuted: v === 0 });
            },
            toggleMute: () => {
                const { isMuted, volume } = get();
                if (isMuted) {
                    engine.setVolume(volume > 0 ? volume : 1.0);
                    set({ isMuted: false });
                } else {
                    engine.setVolume(0);
                    set({ isMuted: true });
                }
            },
            seek: (time) => {
                engine.seek(time);
                set({ position: time });
            },
            updatePosition: (position, duration) => set({ position, duration }),
            addToQueue: (track) => set((state) => ({ queue: [...state.queue, track] })),
            playNext: (track) => set((state) => {
                const newQueue = [...state.queue];
                newQueue.splice(state.currentIndex + 1, 0, track);
                return { queue: newQueue };
            }),
            reorderQueue: (startIndex, endIndex) => set((state) => {
                const newQueue = Array.from(state.queue);
                const [removed] = newQueue.splice(startIndex, 1);
                newQueue.splice(endIndex, 0, removed);
                
                let newCurrentIndex = state.currentIndex;
                if (state.currentIndex === startIndex) {
                    newCurrentIndex = endIndex;
                } else if (state.currentIndex > startIndex && state.currentIndex <= endIndex) {
                    newCurrentIndex--;
                } else if (state.currentIndex < startIndex && state.currentIndex >= endIndex) {
                    newCurrentIndex++;
                }

                return { queue: newQueue, currentIndex: newCurrentIndex };
            }),
            toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),
            toggleRepeat: () => set((state) => {
                const map: Record<RepeatMode, RepeatMode> = { 'off': 'all', 'all': 'one', 'one': 'off' };
                return { repeat: map[state.repeat] };
            }),
        }),
        {
            name: 'aural-player-storage',
            partialize: (state) => ({ 
                queue: state.queue, 
                currentIndex: state.currentIndex, 
                volume: state.volume,
                isMuted: state.isMuted,
                shuffle: state.shuffle,
                repeat: state.repeat
            }),
        }
    )
);

// Event listeners to bridge engine and store
if (typeof window !== 'undefined') {
    window.addEventListener('player:timeupdate', ((e: CustomEvent) => {
        const { currentTime, duration } = e.detail;
        usePlayerStore.getState().updatePosition(currentTime, duration);
    }) as EventListener);

    window.addEventListener('player:ended', () => {
        const state = usePlayerStore.getState();
        if (state.repeat === 'one') {
            engine.seek(0);
            const track = state.queue[state.currentIndex];
            engine.play(track.path);
            invoke('mark_played', { trackId: track.id }).catch(console.error);
        } else {
            state.next();
        }
    });

    // Also handle media session
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => usePlayerStore.getState().resume());
        navigator.mediaSession.setActionHandler('pause', () => usePlayerStore.getState().pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => usePlayerStore.getState().prev());
        navigator.mediaSession.setActionHandler('nexttrack', () => usePlayerStore.getState().next());
    }
}
