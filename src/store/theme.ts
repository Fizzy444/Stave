import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'monochrome' | 'dynamic' | 'custom';

interface ThemeState {
  themeMode: ThemeMode;
  customAccent: string;
  setThemeMode: (mode: ThemeMode) => void;
  setCustomAccent: (hex: string) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themeMode: 'monochrome',
      customAccent: '#ffffff',
      setThemeMode: (mode) => set({ themeMode: mode }),
      setCustomAccent: (hex) => set({ customAccent: hex }),
    }),
    {
      name: 'stave-theme-storage',
    }
  )
);
