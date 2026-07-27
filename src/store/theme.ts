import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeState {
  themeMode: 'dynamic' | 'custom';
  customAccent: string;
  setThemeMode: (mode: 'dynamic' | 'custom') => void;
  setCustomAccent: (hex: string) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themeMode: 'dynamic',
      customAccent: '#007aff',
      setThemeMode: (mode) => set({ themeMode: mode }),
      setCustomAccent: (hex) => set({ customAccent: hex }),
    }),
    {
      name: 'stave-theme-storage',
    }
  )
);
