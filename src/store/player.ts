import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { Track, useLibraryStore } from './library';
import { engine } from '../audio/engine';
import { getYouTubeStreamUrl, getYouTubeRadio, ytItemToTrack } from './ytmusic';

export type RepeatMode = 'off' | 'all' | 'one';
export type QueueOrigin = 'context' | 'user' | 'auto';

export function extractYouTubeId(track: Track): string | null {
    if (track.youtube_id) return track.youtube_id;
    if (track.path && track.path.startsWith('yt:')) return track.path.slice(3);
    if (typeof track.id === 'string' && track.id.startsWith('yt_')) return track.id.slice(3);
    return null;
}

export function isYouTubeTrack(track: Track): boolean {
    return (
        track.source === 'youtube' ||
        (track.path != null && track.path.startsWith('yt:')) ||
        (typeof track.id === 'string' && track.id.startsWith('yt_'))
    );
}

export function trackKey(track: Track): string {
    const ytId = extractYouTubeId(track);
    if (ytId) return `yt:${ytId}`;
    return `local:${String(track.id ?? track.path)}`;
}

export function isUpcomingOrigin(state: PlayerState, origin: QueueOrigin): number {
    return state.queueOrigins
        .slice(state.currentIndex + 1)
        .filter((o) => o === origin).length;
}

const streamUrlCache = new Map<string, string>();
const streamUrlInFlight = new Map<string, Promise<string | null>>();
let currentPlayRequestId = 0;

function cacheStreamUrl(videoId: string, url: string) {
    if (streamUrlCache.size > 150) {
        const firstKey = streamUrlCache.keys().next().value;
        if (firstKey) streamUrlCache.delete(firstKey);
    }
    streamUrlCache.set(videoId, url);
}

type ResolvePriority = 'play' | 'prefetch';

interface ResolveJob {
    videoId: string;
    priority: ResolvePriority;
    promise: Promise<string | null>;
    resolve: (url: string | null) => void;
    reject: (error: unknown) => void;
    started: boolean;
}

const MAX_ACTIVE_RESOLVES = 2;
const MAX_ACTIVE_PREFETCHES = 1;

const pendingResolves: ResolveJob[] = [];
const resolveJobs = new Map<string, ResolveJob>();
let activeResolves = 0;
let activePrefetches = 0;

function startResolveJob(job: ResolveJob) {
    job.started = true;
    activeResolves += 1;
    if (job.priority === 'prefetch') {
        activePrefetches += 1;
    }

    getYouTubeStreamUrl(job.videoId)
        .then((url) => {
            const resolved = url || null;
            if (resolved) cacheStreamUrl(job.videoId, resolved);
            job.resolve(resolved);
        })
        .catch((error) => {
            job.reject(error);
        })
        .finally(() => {
            activeResolves -= 1;
            if (job.priority === 'prefetch') {
                activePrefetches -= 1;
            }
            resolveJobs.delete(job.videoId);
            streamUrlInFlight.delete(job.videoId);
            drainResolveQueue();
        });
}

function drainResolveQueue() {
    while (activeResolves < MAX_ACTIVE_RESOLVES) {
        const playIndex = pendingResolves.findIndex((job) => job.priority === 'play');
        let index = playIndex;

        if (index < 0) {
            if (activePrefetches >= MAX_ACTIVE_PREFETCHES) break;
            index = pendingResolves.findIndex((job) => job.priority === 'prefetch');
        }

        if (index < 0) break;

        const [job] = pendingResolves.splice(index, 1);
        startResolveJob(job);
    }
}

function requestStreamUrl(videoId: string, priority: ResolvePriority): Promise<string | null> {
    const cached = streamUrlCache.get(videoId);
    if (cached) return Promise.resolve(cached);

    const existing = resolveJobs.get(videoId);
    if (existing) {
        if (priority === 'play' && existing.priority !== 'play') {
            existing.priority = 'play';
            drainResolveQueue();
        }
        return existing.promise;
    }

    const inflight = streamUrlInFlight.get(videoId);
    if (inflight) return inflight;

    let resolveJob!: (url: string | null) => void;
    let rejectJob!: (error: unknown) => void;
    const promise = new Promise<string | null>((resolve, reject) => {
        resolveJob = resolve;
        rejectJob = reject;
    });

    const job: ResolveJob = {
        videoId,
        priority,
        promise,
        resolve: resolveJob,
        reject: rejectJob,
        started: false,
    };

    resolveJobs.set(videoId, job);
    streamUrlInFlight.set(videoId, promise);
    pendingResolves.push(job);
    drainResolveQueue();
    return promise;
}

function getStreamUrlWithDedup(videoId: string): Promise<string | null> {
    return requestStreamUrl(videoId, 'prefetch');
}

async function prefetchStreamForTrack(track: Track | undefined, preload = false) {
    if (!track || !isYouTubeTrack(track)) return;
    const videoId = extractYouTubeId(track);
    if (!videoId) return;

    const cached = streamUrlCache.get(videoId);
    if (cached) {
        if (preload) {
            engine.preloadRemote(cached);
        }
        return;
    }

    try {
        const url = await getStreamUrlWithDedup(videoId);
        if (url && preload) {
            engine.preloadRemote(url);
        }
    } catch (err) {
        console.warn('Prefetch stream URL failed:', videoId, err);
    }
}

function prefetchAhead(queue: Track[], currentIndex: number, count = 2) {
    for (let offset = 1; offset <= count; offset += 1) {
        const idx = currentIndex + offset;
        if (idx >= queue.length) break;
        void prefetchStreamForTrack(queue[idx], offset === 1);
    }
}

export function prefetchTracks(tracks: Track[], count = 3) {
    let queued = 0;
    for (const track of tracks) {
        if (queued >= count) break;
        if (!isYouTubeTrack(track)) continue;
        const videoId = extractYouTubeId(track);
        if (!videoId) continue;
        void prefetchStreamForTrack(track);
        queued += 1;
    }
}

export function prefetchTrack(track: Track) {
    void prefetchStreamForTrack(track);
}

const hoverPrefetchTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function prefetchTrackOnHover(track: Track) {
    if (!isYouTubeTrack(track)) return;
    const videoId = extractYouTubeId(track);
    if (!videoId || streamUrlCache.has(videoId) || resolveJobs.has(videoId)) return;
    if (hoverPrefetchTimers.has(videoId)) return;

    const timer = setTimeout(() => {
        hoverPrefetchTimers.delete(videoId);
        prefetchTrack(track);
    }, 120);
    hoverPrefetchTimers.set(videoId, timer);
}

// ==========================================
// AUTO PLAY ENGINE & RESERVOIR
// ==========================================
const AUTO_PLAY_TARGET = 10;
const AUTO_PLAY_RESERVOIR_LOW = 3;
const AUTO_PLAY_CACHE_TTL = 10 * 60_000;
const MAX_QUEUE_HISTORY = 100;

interface AutoPlayReservoir {
    seedId: string | null;
    seedTrack: Track | null;
    tracks: Track[];
    seen: Set<string>;
    generation: number;
    loading: boolean;
}

const reservoir: AutoPlayReservoir = {
    seedId: null,
    seedTrack: null,
    tracks: [],
    seen: new Set(),
    generation: 0,
    loading: false,
};

const radioCache = new Map<string, { promise: Promise<Track[]>; ts: number }>();

function getRadioCached(videoId: string): Promise<Track[]> {
    const now = Date.now();
    const existing = radioCache.get(videoId);
    if (existing && now - existing.ts < AUTO_PLAY_CACHE_TTL) {
        return existing.promise;
    }

    const promise = getYouTubeRadio(videoId).then((items) => {
        const tracks = items.map(ytItemToTrack);
        prefetchTracks(tracks, 2);
        return tracks;
    });

    if (radioCache.size >= 8) {
        const oldestKey = radioCache.keys().next().value;
        if (oldestKey) radioCache.delete(oldestKey);
    }
    radioCache.set(videoId, { promise, ts: now });

    promise.catch(() => {
        radioCache.delete(videoId);
    });

    return promise;
}

function getLocalRecommendations(seedTrack: Track, excludeKeys: Set<string>): Track[] {
    const allTracks = useLibraryStore.getState().tracks || [];
    if (allTracks.length < 3) return [];

    const seedKey = trackKey(seedTrack);
    const pool = allTracks.filter((t) => {
        const k = trackKey(t);
        return k !== seedKey && !excludeKeys.has(k);
    });

    if (pool.length === 0) return [];

    const sameArtist: Track[] = [];
    const sameAlbum: Track[] = [];
    const favorites: Track[] = [];
    const others: Track[] = [];

    for (const t of pool) {
        if (seedTrack.artist && t.artist && t.artist.toLowerCase() === seedTrack.artist.toLowerCase()) {
            sameArtist.push(t);
        } else if (seedTrack.album && t.album && t.album.toLowerCase() === seedTrack.album.toLowerCase()) {
            sameAlbum.push(t);
        } else if (t.favorite) {
            favorites.push(t);
        } else {
            others.push(t);
        }
    }

    const shuffleArr = <T>(arr: T[]): T[] => {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    };

    return [
        ...shuffleArr(sameArtist),
        ...shuffleArr(sameAlbum),
        ...shuffleArr(favorites),
        ...shuffleArr(others),
    ];
}

async function seedAutoPlay(seedTrack: Track, appendImmediately: boolean) {
    const currentGen = ++reservoir.generation;
    reservoir.seedId = trackKey(seedTrack);
    reservoir.seedTrack = seedTrack;
    reservoir.seen.clear();
    reservoir.tracks = [];
    reservoir.loading = true;

    // Track existing queue tracks and play history to prevent duplicates
    const state = usePlayerStore.getState();
    for (const t of state.queue) {
        reservoir.seen.add(trackKey(t));
    }
    for (const t of state.playHistory || []) {
        reservoir.seen.add(trackKey(t));
    }

    usePlayerStore.setState({
        autoPlayLoading: true,
        autoPlayError: null,
        autoPlaySeed: seedTrack.title || (seedTrack.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') ?? 'Now Playing'),
    });

    try {
        let recs: Track[] = [];
        const isYt = isYouTubeTrack(seedTrack);
        const videoId = extractYouTubeId(seedTrack);

        if (isYt && videoId) {
            recs = await getRadioCached(videoId);
        } else {
            recs = getLocalRecommendations(seedTrack, reservoir.seen);
            if (recs.length === 0) {
                if ((useLibraryStore.getState().tracks || []).length < 3) {
                    usePlayerStore.setState({
                        autoPlayLoading: false,
                        autoPlayError: 'Not enough library tracks for an Auto play mix',
                    });
                    reservoir.loading = false;
                    return;
                }
            }
        }

        if (reservoir.generation !== currentGen) return;

        const filtered: Track[] = [];
        for (const t of recs) {
            const k = trackKey(t);
            if (!reservoir.seen.has(k)) {
                reservoir.seen.add(k);
                filtered.push(t);
            }
        }

        const toAdd = filtered.slice(0, AUTO_PLAY_TARGET);
        reservoir.tracks = filtered.slice(AUTO_PLAY_TARGET);
        reservoir.loading = false;

        if (toAdd.length > 0 && appendImmediately) {
            const freshState = usePlayerStore.getState();
            const newQueue = [...freshState.queue, ...toAdd];
            const newOrigins = [...freshState.queueOrigins, ...toAdd.map(() => 'auto' as QueueOrigin)];
            usePlayerStore.setState({
                queue: newQueue,
                queueOrigins: newOrigins,
                autoPlayLoading: false,
                autoPlayError: null,
            });
            prefetchAhead(newQueue, freshState.currentIndex, 2);
        } else {
            usePlayerStore.setState({
                autoPlayLoading: false,
                autoPlayError: toAdd.length === 0 ? 'No recommendations found' : null,
            });
        }
    } catch (err: any) {
        if (reservoir.generation !== currentGen) return;
        reservoir.loading = false;
        console.error('seedAutoPlay failed:', err);
        usePlayerStore.setState({
            autoPlayLoading: false,
            autoPlayError: typeof err === 'string' ? err : err?.message || 'Failed to load recommendations',
        });
    }
}

async function refillReservoir() {
    if (reservoir.loading) return;
    const state = usePlayerStore.getState();
    if (!state.autoPlayEnabled) return;

    reservoir.loading = true;
    const currentGen = reservoir.generation;

    // Use current playing track, last played auto track, or original seed as candidate
    const currentTrack = state.currentIndex >= 0 ? state.queue[state.currentIndex] : null;
    const seed = currentTrack || reservoir.seedTrack;
    if (!seed) {
        reservoir.loading = false;
        return;
    }

    try {
        let recs: Track[] = [];
        const isYt = isYouTubeTrack(seed);
        const videoId = extractYouTubeId(seed);

        if (isYt && videoId) {
            recs = await getRadioCached(videoId);
        } else {
            recs = getLocalRecommendations(seed, reservoir.seen);
        }

        if (reservoir.generation !== currentGen) {
            reservoir.loading = false;
            return;
        }

        const freshTracks: Track[] = [];
        for (const t of recs) {
            const k = trackKey(t);
            if (!reservoir.seen.has(k)) {
                reservoir.seen.add(k);
                freshTracks.push(t);
            }
        }

        reservoir.tracks.push(...freshTracks);
    } catch (err) {
        console.warn('refillReservoir error:', err);
    } finally {
        reservoir.loading = false;
    }
}

async function maintainAutoPlay() {
    const state = usePlayerStore.getState();
    if (!state.autoPlayEnabled) return;

    const upcomingAutoCount = state.queueOrigins
        .slice(state.currentIndex + 1)
        .filter((o) => o === 'auto').length;

    if (upcomingAutoCount >= AUTO_PLAY_TARGET) {
        if (reservoir.tracks.length < AUTO_PLAY_RESERVOIR_LOW) {
            void refillReservoir();
        }
        return;
    }

    const needed = AUTO_PLAY_TARGET - upcomingAutoCount;

    if (reservoir.tracks.length < needed) {
        await refillReservoir();
    }

    if (reservoir.tracks.length > 0) {
        const toAppend = reservoir.tracks.splice(0, needed);
        const freshState = usePlayerStore.getState();
        const newQueue = [...freshState.queue, ...toAppend];
        const newOrigins = [...freshState.queueOrigins, ...toAppend.map(() => 'auto' as QueueOrigin)];
        usePlayerStore.setState({
            queue: newQueue,
            queueOrigins: newOrigins,
        });
        prefetchAhead(newQueue, freshState.currentIndex, 2);
    }

    if (reservoir.tracks.length < AUTO_PLAY_RESERVOIR_LOW) {
        void refillReservoir();
    }
}

async function ensureAutoTracks() {
    const state = usePlayerStore.getState();
    if (!state.autoPlayEnabled) return;

    const upcomingCount = state.queue.length - 1 - state.currentIndex;
    if (upcomingCount <= 0) {
        if (reservoir.tracks.length === 0) {
            await refillReservoir();
        }
        if (reservoir.tracks.length > 0) {
            const toAppend = reservoir.tracks.splice(0, Math.min(AUTO_PLAY_TARGET, reservoir.tracks.length));
            const freshState = usePlayerStore.getState();
            const newQueue = [...freshState.queue, ...toAppend];
            const newOrigins = [...freshState.queueOrigins, ...toAppend.map(() => 'auto' as QueueOrigin)];
            usePlayerStore.setState({
                queue: newQueue,
                queueOrigins: newOrigins,
                autoPlayLoading: false,
            });
            prefetchAhead(newQueue, freshState.currentIndex, 2);
        }
    }
}

async function advanceTo(index: number) {
    const state = usePlayerStore.getState();
    if (index < 0 || index >= state.queue.length) return;

    let targetIndex = index;
    let newQueue = state.queue;
    let newOrigins = state.queueOrigins;

    // History trimming: prevent unbounded memory/persistence growth
    if (targetIndex > MAX_QUEUE_HISTORY) {
        const drop = targetIndex - MAX_QUEUE_HISTORY;
        newQueue = newQueue.slice(drop);
        newOrigins = newOrigins.slice(drop);
        targetIndex = targetIndex - drop;
    }

    usePlayerStore.setState({
        queue: newQueue,
        queueOrigins: newOrigins,
        currentIndex: targetIndex,
        isPlaying: true,
        position: 0,
    });

    const track = newQueue[targetIndex];
    if (track) {
        await executePlayTrack(track, usePlayerStore.setState, usePlayerStore.getState);
    }

    prefetchAhead(newQueue, targetIndex, 2);
    void maintainAutoPlay();
}

async function executePlayTrack(
    track: Track,
    set: (partial: Partial<PlayerState> | ((state: PlayerState) => Partial<PlayerState>)) => void,
    get: () => PlayerState
) {
    const playId = ++currentPlayRequestId;
    const isYt = isYouTubeTrack(track);

    if (isYt) {
        const videoId = extractYouTubeId(track);
        if (!videoId) {
            console.error('Missing YouTube video ID for track:', track);
            return;
        }

        const cachedUrl = streamUrlCache.get(videoId);
        if (cachedUrl) {
            set({ isLoadingStream: false });
            engine.playRemote(cachedUrl);
        } else {
            set({ isLoadingStream: true });
            try {
                const streamUrl = await requestStreamUrl(videoId, 'play');
                if (playId !== currentPlayRequestId) {
                    return; // Request was superseded
                }
                if (!streamUrl) {
                    throw new Error('Empty stream URL');
                }
                cacheStreamUrl(videoId, streamUrl);
                engine.playRemote(streamUrl);
            } catch (err) {
                console.error('Failed to get YouTube stream URL:', err);
                return;
            } finally {
                if (playId === currentPlayRequestId) {
                    set({ isLoadingStream: false });
                }
            }
        }
    } else {
        set({ isLoadingStream: false });
        engine.playLocal(track.path);
        if (typeof track.id === 'number') {
            invoke('mark_played', { trackId: track.id }).catch(console.error);
        }
    }

    // Record into playHistory (only genuinely played tracks)
    const currentHistory = get().playHistory || [];
    const cleanId = (t: Track) => String(t.youtube_id || t.path || t.id);
    const targetId = cleanId(track);
    const filteredHistory = currentHistory.filter((t) => cleanId(t) !== targetId);
    set({ playHistory: [track, ...filteredHistory].slice(0, 50) });

    // Pre-fetch upcoming tracks in background
    const { queue, currentIndex } = get();
    prefetchAhead(queue, currentIndex, 2);
}

export interface PlayerState {
    queue: Track[];
    queueOrigins: QueueOrigin[];
    currentIndex: number;
    isPlaying: boolean;
    volume: number;
    isMuted: boolean;
    shuffle: boolean;
    repeat: RepeatMode;
    position: number;
    duration: number;
    isLoadingStream: boolean;
    autoPlayEnabled: boolean;
    autoPlaySeed: string | null;
    autoPlayLoading: boolean;
    autoPlayError: string | null;
    queueContextLabel: string | null;
    playHistory: Track[];

    play: (track: Track) => Promise<void> | void;
    playDiscover: (track: Track) => Promise<void>;
    playContext: (tracks: Track[], startIndex: number, options?: { contextLabel?: string }) => Promise<void>;
    playRadio: (seedVideoId: string, recommendations: Track[]) => Promise<void>;
    playAtIndex: (index: number) => Promise<void>;
    pause: () => void;
    resume: () => Promise<void> | void;
    next: () => Promise<void> | void;
    prev: () => Promise<void> | void;
    setVolume: (v: number) => void;
    toggleMute: () => void;
    seek: (time: number) => void;
    updatePosition: (time: number, duration: number) => void;
    addToQueue: (track: Track) => void;
    playNext: (track: Track) => void;
    removeAt: (index: number) => void;
    clearUpcoming: () => void;
    clearUserQueue: () => void;
    clearAutoPlay: () => void;
    reorderQueue: (startIndex: number, endIndex: number) => void;
    reorderUserQueue: (fromUserIndex: number, toUserIndex: number) => void;
    toggleShuffle: () => void;
    toggleRepeat: () => void;
    toggleAutoPlay: () => void;
    setAutoPlayEnabled: (enabled: boolean) => void;
    refreshAutoPlay: () => Promise<void>;
}

export const usePlayerStore = create<PlayerState>()(
    persist(
        (set, get) => ({
            queue: [],
            queueOrigins: [],
            currentIndex: -1,
            isPlaying: false,
            volume: 1.0,
            isMuted: false,
            shuffle: false,
            repeat: 'off',
            position: 0,
            duration: 0,
            isLoadingStream: false,
            autoPlayEnabled: true,
            autoPlaySeed: null,
            autoPlayLoading: false,
            autoPlayError: null,
            queueContextLabel: null,
            playHistory: [],

            play: async (track) => {
                const { queue } = get();
                const idx = queue.findIndex((t) => t.id === track.id);
                if (idx >= 0) {
                    await advanceTo(idx);
                } else {
                    await get().playDiscover(track);
                }
            },

            playDiscover: async (track) => {
                set({
                    queue: [track],
                    queueOrigins: ['context'],
                    currentIndex: 0,
                    isPlaying: true,
                    position: 0,
                    queueContextLabel: null,
                    autoPlaySeed: track.title || (track.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') ?? 'Now Playing'),
                });
                await executePlayTrack(track, set, get);
                if (get().autoPlayEnabled) {
                    void seedAutoPlay(track, true);
                }
            },

            playContext: async (tracks, startIndex, options) => {
                if (tracks.length === 0 || startIndex < 0 || startIndex >= tracks.length) return;
                const track = tracks[startIndex];
                set({
                    queue: tracks,
                    queueOrigins: tracks.map(() => 'context' as QueueOrigin),
                    currentIndex: startIndex,
                    isPlaying: true,
                    position: 0,
                    queueContextLabel: options?.contextLabel || null,
                    autoPlaySeed: track.title || (track.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') ?? 'Now Playing'),
                });
                await executePlayTrack(track, set, get);
                if (get().autoPlayEnabled) {
                    void seedAutoPlay(track, true);
                }
            },

            playRadio: async (seedVideoId, recommendations) => {
                if (recommendations.length === 0) return;
                const first = recommendations[0];
                const initialAuto = recommendations.slice(1, 11);
                const reservoirRemaining = recommendations.slice(11);

                reservoir.seedId = `yt:${seedVideoId}`;
                reservoir.seedTrack = first;
                reservoir.seen.clear();
                reservoir.seen.add(`yt:${seedVideoId}`);
                for (const t of recommendations) reservoir.seen.add(trackKey(t));
                reservoir.tracks = reservoirRemaining;
                reservoir.generation++;
                reservoir.loading = false;

                set({
                    queue: [first, ...initialAuto],
                    queueOrigins: ['context', ...initialAuto.map(() => 'auto' as QueueOrigin)],
                    currentIndex: 0,
                    isPlaying: true,
                    position: 0,
                    queueContextLabel: 'Radio',
                    autoPlaySeed: first.title || first.artist || 'Radio',
                    autoPlayLoading: false,
                    autoPlayError: null,
                });
                await executePlayTrack(first, set, get);
                prefetchAhead([first, ...initialAuto], 0, 2);
            },

            playAtIndex: async (index) => {
                const { queue } = get();
                if (index >= 0 && index < queue.length) {
                    await advanceTo(index);
                }
            },

            pause: () => {
                engine.pause();
                set({ isPlaying: false });
            },

            resume: async () => {
                const { queue, currentIndex } = get();
                if (currentIndex >= 0 && queue[currentIndex]) {
                    const track = queue[currentIndex];
                    set({ isPlaying: true });
                    const isYt = isYouTubeTrack(track);
                    if (isYt) {
                        const videoId = extractYouTubeId(track);
                        const cachedUrl = videoId ? streamUrlCache.get(videoId) : null;
                        if (cachedUrl) {
                            engine.resume(cachedUrl);
                        } else {
                            await executePlayTrack(track, set, get);
                        }
                    } else {
                        engine.playLocal(track.path);
                    }
                }
            },

            next: async () => {
                const state = get();
                if (state.queue.length === 0) return;

                // End of queue: try to extend auto play before repeating/stopping.
                if (state.currentIndex >= state.queue.length - 1) {
                    if (state.autoPlayEnabled) {
                        await ensureAutoTracks();
                        const updated = get();
                        if (updated.currentIndex < updated.queue.length - 1) {
                            await advanceTo(updated.currentIndex + 1);
                            return;
                        }
                    }
                    if (state.repeat === 'all') {
                        await advanceTo(0);
                        return;
                    }
                    set({ isPlaying: false, position: 0 });
                    return;
                }

                await advanceTo(state.currentIndex + 1);
                void maintainAutoPlay();
            },

            prev: async () => {
                const { queue, currentIndex, position } = get();
                if (queue.length === 0) return;

                if (position > 3) {
                    engine.seek(0);
                    set({ position: 0 });
                    return;
                }

                let prevIdx = currentIndex - 1;
                if (prevIdx < 0) prevIdx = 0;
                await advanceTo(prevIdx);
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

            addToQueue: (track) =>
                set((state) => {
                    let insertIndex = state.currentIndex + 1;
                    while (insertIndex < state.queue.length && state.queueOrigins[insertIndex] === 'user') {
                        insertIndex++;
                    }
                    const newQueue = [...state.queue];
                    const newOrigins = [...state.queueOrigins];
                    newQueue.splice(insertIndex, 0, track);
                    newOrigins.splice(insertIndex, 0, 'user');
                    prefetchAhead(newQueue, state.currentIndex, 2);
                    return { queue: newQueue, queueOrigins: newOrigins };
                }),

            playNext: (track) =>
                set((state) => {
                    const insertIndex = Math.max(0, state.currentIndex + 1);
                    const newQueue = [...state.queue];
                    const newOrigins = [...state.queueOrigins];
                    newQueue.splice(insertIndex, 0, track);
                    newOrigins.splice(insertIndex, 0, 'user');
                    prefetchAhead(newQueue, state.currentIndex, 2);
                    return { queue: newQueue, queueOrigins: newOrigins };
                }),

            removeAt: (index) => {
                const state = get();
                if (index < 0 || index >= state.queue.length) return;
                const newQueue = [...state.queue];
                const newOrigins = [...state.queueOrigins];
                newQueue.splice(index, 1);
                const [removedOrigin] = newOrigins.splice(index, 1);

                if (index === state.currentIndex) {
                    if (newQueue.length === 0) {
                        engine.pause();
                        set({ queue: [], queueOrigins: [], currentIndex: -1, isPlaying: false, position: 0 });
                        return;
                    }
                    const nextIdx = Math.min(index, newQueue.length - 1);
                    set({ queue: newQueue, queueOrigins: newOrigins, currentIndex: nextIdx, position: 0 });
                    void executePlayTrack(newQueue[nextIdx], set, get);
                } else if (index < state.currentIndex) {
                    set({ queue: newQueue, queueOrigins: newOrigins, currentIndex: state.currentIndex - 1 });
                } else {
                    set({ queue: newQueue, queueOrigins: newOrigins });
                    if (removedOrigin === 'auto') {
                        void maintainAutoPlay();
                    }
                }
            },

            clearUpcoming: () => {
                const state = get();
                const keepCount = Math.max(0, state.currentIndex + 1);
                set({
                    queue: state.queue.slice(0, keepCount),
                    queueOrigins: state.queueOrigins.slice(0, keepCount),
                });
            },

            clearUserQueue: () => {
                const state = get();
                const historyAndCurrent = state.queue.slice(0, state.currentIndex + 1);
                const historyOrigins = state.queueOrigins.slice(0, state.currentIndex + 1);
                const upcomingTracks: Track[] = [];
                const upcomingOrigins: QueueOrigin[] = [];

                for (let i = state.currentIndex + 1; i < state.queue.length; i++) {
                    if (state.queueOrigins[i] !== 'user') {
                        upcomingTracks.push(state.queue[i]);
                        upcomingOrigins.push(state.queueOrigins[i]);
                    }
                }

                set({
                    queue: [...historyAndCurrent, ...upcomingTracks],
                    queueOrigins: [...historyOrigins, ...upcomingOrigins],
                });
            },

            clearAutoPlay: () => {
                const state = get();
                const historyAndCurrent = state.queue.slice(0, state.currentIndex + 1);
                const historyOrigins = state.queueOrigins.slice(0, state.currentIndex + 1);
                const upcomingTracks: Track[] = [];
                const upcomingOrigins: QueueOrigin[] = [];

                for (let i = state.currentIndex + 1; i < state.queue.length; i++) {
                    if (state.queueOrigins[i] !== 'auto') {
                        upcomingTracks.push(state.queue[i]);
                        upcomingOrigins.push(state.queueOrigins[i]);
                    }
                }

                set({
                    queue: [...historyAndCurrent, ...upcomingTracks],
                    queueOrigins: [...historyOrigins, ...upcomingOrigins],
                });
            },

            reorderQueue: (startIndex, endIndex) =>
                set((state) => {
                    const newQueue = Array.from(state.queue);
                    const newOrigins = Array.from(state.queueOrigins);
                    const [removedTrack] = newQueue.splice(startIndex, 1);
                    const [removedOrigin] = newOrigins.splice(startIndex, 1);
                    newQueue.splice(endIndex, 0, removedTrack);
                    newOrigins.splice(endIndex, 0, removedOrigin);

                    let newCurrentIndex = state.currentIndex;
                    if (state.currentIndex === startIndex) {
                        newCurrentIndex = endIndex;
                    } else if (state.currentIndex > startIndex && state.currentIndex <= endIndex) {
                        newCurrentIndex--;
                    } else if (state.currentIndex < startIndex && state.currentIndex >= endIndex) {
                        newCurrentIndex++;
                    }

                    return { queue: newQueue, queueOrigins: newOrigins, currentIndex: newCurrentIndex };
                }),

            reorderUserQueue: (fromUserIndex, toUserIndex) => {
                const state = get();
                const userIndices: number[] = [];
                for (let i = state.currentIndex + 1; i < state.queue.length; i++) {
                    if (state.queueOrigins[i] === 'user') {
                        userIndices.push(i);
                    }
                }
                if (
                    fromUserIndex < 0 ||
                    fromUserIndex >= userIndices.length ||
                    toUserIndex < 0 ||
                    toUserIndex >= userIndices.length ||
                    fromUserIndex === toUserIndex
                ) {
                    return;
                }

                const absFrom = userIndices[fromUserIndex];
                const absTo = userIndices[toUserIndex];

                const newQueue = [...state.queue];
                const newOrigins = [...state.queueOrigins];
                const [track] = newQueue.splice(absFrom, 1);
                const [origin] = newOrigins.splice(absFrom, 1);
                newQueue.splice(absTo, 0, track);
                newOrigins.splice(absTo, 0, origin);

                set({ queue: newQueue, queueOrigins: newOrigins });
            },

            toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),

            toggleRepeat: () =>
                set((state) => {
                    const map: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };
                    return { repeat: map[state.repeat] };
                }),

            toggleAutoPlay: () => {
                const current = get().autoPlayEnabled;
                const nextVal = !current;
                set({ autoPlayEnabled: nextVal });
                if (nextVal) {
                    const state = get();
                    const currentTrack = state.currentIndex >= 0 ? state.queue[state.currentIndex] : null;
                    if (currentTrack) {
                        void seedAutoPlay(currentTrack, true);
                    }
                }
            },

            setAutoPlayEnabled: (autoPlayEnabled) => {
                set({ autoPlayEnabled });
                if (autoPlayEnabled) {
                    const state = get();
                    const currentTrack = state.currentIndex >= 0 ? state.queue[state.currentIndex] : null;
                    if (currentTrack) {
                        void seedAutoPlay(currentTrack, true);
                    }
                }
            },

            refreshAutoPlay: async () => {
                const state = get();
                if (!state.autoPlayEnabled) return;
                const currentTrack = state.currentIndex >= 0 ? state.queue[state.currentIndex] : null;
                if (!currentTrack) return;

                const historyAndCurrent = state.queue.slice(0, state.currentIndex + 1);
                const historyOrigins = state.queueOrigins.slice(0, state.currentIndex + 1);
                const upcomingTracks: Track[] = [];
                const upcomingOrigins: QueueOrigin[] = [];

                for (let i = state.currentIndex + 1; i < state.queue.length; i++) {
                    if (state.queueOrigins[i] !== 'auto') {
                        upcomingTracks.push(state.queue[i]);
                        upcomingOrigins.push(state.queueOrigins[i]);
                    }
                }

                set({
                    queue: [...historyAndCurrent, ...upcomingTracks],
                    queueOrigins: [...historyOrigins, ...upcomingOrigins],
                    autoPlayLoading: true,
                    autoPlayError: null,
                });

                await seedAutoPlay(currentTrack, true);
            },
        }),
        {
            name: 'aural-player-storage',
            version: 2,
            migrate: (persisted, _version) => {
                const p = persisted as any;

                if (!Array.isArray(p.queueOrigins) || p.queueOrigins.length !== (p.queue?.length ?? 0)) {
                    p.queueOrigins = (p.queue ?? []).map(() => 'context');
                }

                if (p.autoPlayEnabled === undefined) {
                    p.autoPlayEnabled = p.autoRadio ?? true;
                }
                delete p.autoRadio;

                return p;
            },
            partialize: (state) => ({
                queue: state.queue,
                queueOrigins: state.queueOrigins,
                currentIndex: state.currentIndex,
                volume: state.volume,
                isMuted: state.isMuted,
                shuffle: state.shuffle,
                repeat: state.repeat,
                autoPlayEnabled: state.autoPlayEnabled,
                autoPlaySeed: state.autoPlaySeed,
                queueContextLabel: state.queueContextLabel,
                playHistory: state.playHistory,
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
            if (track) {
                executePlayTrack(track, usePlayerStore.setState, usePlayerStore.getState);
            }
        } else {
            void state.next();
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
