import { convertFileSrc } from '@tauri-apps/api/core';
import { Equalizer } from "./eq";

export class AudioEngine {
    private audioContext: AudioContext;
    private mediaElement: HTMLAudioElement;
    private sourceNode: MediaElementAudioSourceNode;
    public eq: Equalizer;

    constructor() {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.mediaElement = new Audio();
        this.mediaElement.crossOrigin = "anonymous";
        
        this.sourceNode = this.audioContext.createMediaElementSource(this.mediaElement);
        
        this.eq = new Equalizer(this.audioContext);
        
        this.sourceNode.connect(this.eq.input);
        this.eq.output.connect(this.audioContext.destination);

        this.mediaElement.addEventListener('ended', () => {
            window.dispatchEvent(new CustomEvent('player:ended'));
        });

        this.mediaElement.addEventListener('timeupdate', () => {
            window.dispatchEvent(new CustomEvent('player:timeupdate', {
                detail: {
                    currentTime: this.mediaElement.currentTime,
                    duration: this.mediaElement.duration || 0
                }
            }));
        });
    }

    public play(path: string) {
        // If it's a new path, update src
        const url = convertFileSrc(path, 'asset');
        if (this.mediaElement.src !== url) {
            this.mediaElement.src = url;
        }
        
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        
        this.mediaElement.play().catch(e => console.error("Playback failed", e));
    }

    public pause() {
        this.mediaElement.pause();
    }

    public seek(time: number) {
        this.mediaElement.currentTime = time;
    }

    public setVolume(volume: number) {
        this.mediaElement.volume = volume;
    }
}

export const engine = new AudioEngine();
