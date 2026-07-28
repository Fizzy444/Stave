import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultPresets, EqPreset } from '../audio/presets';
import { engine } from '../audio/engine';

interface EqState {
    isEnabled: boolean;
    activePresetName: string;
    customPresets: EqPreset[];
    currentGains: number[];
    currentPreamp: number;

    toggleEnabled: () => void;
    applyPreset: (name: string) => void;
    setBandGain: (index: number, gain: number) => void;
    setPreamp: (gain: number) => void;
}

export const useEqStore = create<EqState>()(
    persist(
        (set, get) => ({
            isEnabled: true,
            activePresetName: 'Flat',
            customPresets: [],
            currentGains: [0,0,0,0,0,0,0,0,0,0],
            currentPreamp: 0,

            toggleEnabled: () => set(state => {
                const isEnabled = !state.isEnabled;
                if (isEnabled) {
                    engine.eq.setGains(state.currentGains, state.currentPreamp);
                } else {
                    engine.eq.setGains([0,0,0,0,0,0,0,0,0,0], 0);
                }
                return { isEnabled };
            }),
            applyPreset: (name) => {
                const all = [...defaultPresets, ...get().customPresets];
                const p = all.find(x => x.name === name);
                if (p) {
                    if (get().isEnabled) engine.eq.setGains(p.gains, p.preamp);
                    set({ activePresetName: p.name, currentGains: [...p.gains], currentPreamp: p.preamp });
                }
            },
            setBandGain: (i, gain) => {
                const gains = [...get().currentGains];
                gains[i] = gain;
                if (get().isEnabled) engine.eq.setGains(gains, get().currentPreamp);
                set({ currentGains: gains, activePresetName: 'Custom' });
            },
            setPreamp: (gain) => {
                if (get().isEnabled) engine.eq.setGains(get().currentGains, gain);
                set({ currentPreamp: gain, activePresetName: 'Custom' });
            }
        }),
        {
            name: 'aural-eq-storage',
            onRehydrateStorage: () => (state) => {
                if (state && state.isEnabled) {
                    setTimeout(() => engine.eq.setGains(state.currentGains, state.currentPreamp), 100);
                }
            }
        }
    )
);
