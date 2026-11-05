import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { Equalizer } from "./eq";

export class AudioEngine {
    private audioContext: AudioContext;
    private localElement: HTMLAudioElement;
    // Two remote elements let us pre-buffer the next stream in the idle one and
    // swap it in instantly when the track changes.
    private remoteElements: [HTMLAudioElement, HTMLAudioElement];
    private activeRemote: HTMLAudioElement;
    private currentMode: 'local' | 'remote' = 'local';
    private sourceNode: MediaElementAudioSourceNode;
    public eq: Equalizer;
    private currentVolume: number = 1.0;
    private proxyBaseUrl: string | null = null;
    private proxyBasePromise: Promise<string | null> | null = null;
    private playId = 0;

    constructor() {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

        // 1. Local audio element - routed through WebAudio Equalizer. Local files
        // are streamed from the loopback media server so seeking works without
        // loading the whole file into memory.
        this.localElement = new Audio();
        this.localElement.crossOrigin = "anonymous";
        this.localElement.preload = "auto";
        (this.localElement as any).referrerPolicy = "no-referrer";
        this.sourceNode = this.audioContext.createMediaElementSource(this.localElement);
        this.eq = new Equalizer(this.audioContext);
        this.sourceNode.connect(this.eq.input);
        this.eq.output.connect(this.audioContext.destination);

        // 2. Remote streaming elements - played directly through native audio.
        this.remoteElements = [new Audio(), new Audio()];
        this.activeRemote = this.remoteElements[0];
        for (const element of this.remoteElements) {
            element.preload = "auto";
            (element as any).referrerPolicy = "no-referrer";
            this.setupListeners(element);
        }

        this.setupLocalListeners();

        // Resolve the media server address early so the first local play does not
        // wait for an extra IPC round-trip.
        void this.ensureProxyBase();
    }

    private setupLocalListeners() {
        this.localElement.addEventListener('ended', () => {
            if (this.currentMode === 'local') {
                window.dispatchEvent(new CustomEvent('player:ended'));
            }
        });

        this.localElement.addEventListener('timeupdate', () => {
            if (this.currentMode === 'local') {
                window.dispatchEvent(new CustomEvent('player:timeupdate', {
                    detail: {
                        currentTime: this.localElement.currentTime,
                        duration: this.localElement.duration || 0
                    }
                }));
            }
        });

        this.localElement.addEventListener('error', (e) => {
            if (this.currentMode === 'local') {
                console.error('[AudioEngine] local playback error:', this.localElement.error, e);
            }
        });
    }

    private setupListeners(element: HTMLAudioElement) {
        element.addEventListener('ended', () => {
            if (this.currentMode === 'remote' && element === this.activeRemote) {
                window.dispatchEvent(new CustomEvent('player:ended'));
            }
        });

        element.addEventListener('timeupdate', () => {
            if (this.currentMode === 'remote' && element === this.activeRemote) {
                window.dispatchEvent(new CustomEvent('player:timeupdate', {
                    detail: {
                        currentTime: element.currentTime,
                        duration: element.duration || 0
                    }
                }));
            }
        });

        element.addEventListener('error', (e) => {
            if (this.currentMode === 'remote' && element === this.activeRemote) {
                console.error('[AudioEngine] remote playback error:', element.error, e);
            }
        });
    }

    private ensureProxyBase(): Promise<string | null> {
        if (this.proxyBaseUrl) {
            return Promise.resolve(this.proxyBaseUrl);
        }
        if (!this.proxyBasePromise) {
            this.proxyBasePromise = invoke<string>('media_proxy_base_url')
                .then((base) => {
                    if (base) {
                        this.proxyBaseUrl = base;
                        return base;
                    }
                    return null;
                })
                .catch((error) => {
                    console.warn('[AudioEngine] Local media server unavailable:', error);
                    return null;
                })
                .finally(() => {
                    this.proxyBasePromise = null;
                });
        }
        return this.proxyBasePromise;
    }

    private async localStreamUrl(path: string): Promise<string> {
        const base = await this.ensureProxyBase();
        if (base) {
            return `${base}/local?path=${encodeURIComponent(path)}`;
        }
        // Fallback for the tiny window before the loopback server is listening.
        return convertFileSrc(path, 'asset');
    }

    private resumeContext() {
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(console.error);
        }
    }

    public async playLocal(path: string) {
        const playId = ++this.playId;
        this.currentMode = 'local';
        this.activeRemote.pause();
        this.resumeContext();

        const url = await this.localStreamUrl(path);
        if (playId !== this.playId) return;

        this.localElement.volume = this.currentVolume;
        if (this.localElement.src !== url) {
            this.localElement.src = url;
            this.localElement.load();
        }

        this.localElement.play().catch((error) => {
            console.error("[AudioEngine] Local element playback failed:", error);
        });
    }

    public playRemote(url: string) {
        ++this.playId;
        this.currentMode = 'remote';
        this.localElement.pause();
        this.resumeContext();

        // Prefer the idle element if it already has this URL buffered.
        const idle = this.remoteElements.find((element) => element !== this.activeRemote);
        const preloaded = this.remoteElements.find(
            (element) => element !== this.activeRemote && element.src === url
        );
        let target = preloaded ?? idle ?? this.activeRemote;

        if (target !== this.activeRemote) {
            this.activeRemote.pause();
            this.activeRemote = target;
        }

        target.volume = this.currentVolume;
        target.preload = 'auto';
        if (target.src !== url) {
            target.src = url;
            target.load();
        } else if (target !== this.activeRemote) {
            // A previously used/preloaded element may still hold an old playback
            // position. A fresh play request always starts from the beginning.
            try {
                target.currentTime = 0;
            } catch {
                // Ignore seek errors on metadata that is not ready yet.
            }
        }

        target.play().catch((error) => {
            console.error("[AudioEngine] Stream playback failed:", error);
        });
    }

    /**
     * Buffers the next stream in the idle audio element. When the queue advances,
     * playRemote swaps that element in without another round-trip.
     */
    public preloadRemote(url: string) {
        if (!url) return;
        if (this.currentMode === 'remote' && this.activeRemote.src === url) return;

        const idle = this.remoteElements.find((element) => element !== this.activeRemote);
        if (!idle || idle.src === url) return;

        idle.preload = 'auto';
        idle.src = url;
        idle.load();
    }

    public play(path: string) {
        const isLocalFile = !path.startsWith('http://') && !path.startsWith('https://');
        if (isLocalFile) {
            void this.playLocal(path);
        } else {
            this.playRemote(path);
        }
    }

    public resume(url?: string) {
        this.resumeContext();
        if (this.currentMode === 'remote') {
            // If the active element already holds this stream, continue from the
            // paused position instead of reloading it from the start.
            if (url && this.activeRemote.src !== url) {
                this.playRemote(url);
                return;
            }
            this.activeRemote.play().catch((error) => {
                console.error('[AudioEngine] Resume failed:', error);
            });
            return;
        }

        this.localElement.play().catch((error) => {
            console.error('[AudioEngine] Resume failed:', error);
        });
    }

    public pause() {
        this.localElement.pause();
        this.activeRemote.pause();
    }

    public seek(time: number) {
        if (this.currentMode === 'remote') {
            this.activeRemote.currentTime = time;
        } else {
            this.localElement.currentTime = time;
        }
    }

    public setVolume(volume: number) {
        this.currentVolume = Math.max(0, Math.min(1, volume));
        this.localElement.volume = this.currentVolume;
        for (const element of this.remoteElements) {
            element.volume = this.currentVolume;
        }
    }
}

export const engine = new AudioEngine();
