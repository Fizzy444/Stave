import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface YTAccountInfo {
  is_authenticated: boolean;
  name: string;
  email: string;
  avatar_url?: string | null;
  channel_title?: string | null;
  channel_id?: string | null;
  auth_type: string;
  updated_at: number;
}

let stopListeningForCapturedSession: (() => void) | null = null;

async function refreshProfile(account: YTAccountInfo): Promise<YTAccountInfo> {
  if (!account.is_authenticated) return account;
  try {
    return await invoke<YTAccountInfo>('yt_auth_refresh_account_profile');
  } catch (error) {
    console.warn('Could not refresh YouTube profile:', error);
    return account;
  }
}

export interface YTAuthState {
  account: YTAccountInfo | null;
  isLoading: boolean;
  isModalOpen: boolean;
  error: string | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
  signInBrowser: (clientId?: string, clientSecret?: string) => Promise<void>;
  syncBrowserCookies: (browser?: string) => Promise<void>;
  signOut: () => Promise<void>;
  openWebLogin: () => Promise<void>;
  openInAppLogin: () => Promise<void>;
  saveCustomAccount: (name: string, email?: string, cookie?: string) => Promise<void>;
}

export const useYTAuthStore = create<YTAuthState>((set) => ({
  account: null,
  isLoading: false,
  isModalOpen: false,
  error: null,

  init: async () => {
    try {
      if (!stopListeningForCapturedSession) {
        stopListeningForCapturedSession = await listen<YTAccountInfo>('yt-auth-session-captured', (event) => {
          // The Rust side watches the sign-in window and emits as soon as YouTube
          // Music has a valid session, so the UI updates without waiting for a close.
          set({
            account: event.payload,
            error: null,
            isLoading: false,
            isModalOpen: false,
          });
        });
      }
      const acc = await invoke<YTAccountInfo | null>('yt_auth_get_account');
      if (acc && acc.is_authenticated) {
        set({ account: acc });
        refreshProfile(acc).then((profile) => set({ account: profile }));
      }
    } catch (e) {
      console.warn('Failed to load YouTube account from storage:', e);
    }
  },

  openModal: () => set({ isModalOpen: true, error: null }),
  closeModal: () => set({ isModalOpen: false, error: null, isLoading: false }),

  /**
   * Re-reads the session from disk. Used when the app regains focus, which is the
   * moment the sign-in window closes, so the UI never depends solely on an event.
   */
  refresh: async () => {
    try {
      const acc = await invoke<YTAccountInfo | null>('yt_auth_get_account');
      if (acc && acc.is_authenticated) {
        set({ account: acc, error: null });
        // The session can be captured before the profile request finishes, and
        // older sessions may have been stored without a profile. Backfill it on
        // focus so the sidebar always has a name/avatar.
        const nowSecs = Math.floor(Date.now() / 1000);
        const stale =
          !acc.name ||
          !acc.avatar_url ||
          !acc.channel_id ||
          nowSecs - (acc.updated_at || 0) > 10 * 60;
        if (stale) {
          const profile = await refreshProfile(acc);
          set({ account: profile });
        }
      }
    } catch (e) {
      console.warn('Failed to refresh YouTube account:', e);
    }
  },

  openInAppLogin: async () => {
    set({ isLoading: true, error: null });
    try {
      await invoke('yt_auth_open_login_window');
      set({ isLoading: false });
    } catch (e: any) {
      console.error('Failed to open login window:', e);
      set({
        error: typeof e === 'string' ? e : e?.message || 'Failed to open sign-in window',
        isLoading: false,
      });
    }
  },

  saveCustomAccount: async (name: string, email?: string, cookie?: string) => {
    set({ isLoading: true, error: null });
    try {
      const acc = await invoke<YTAccountInfo>('yt_auth_save_custom_account', {
        name,
        email: email || null,
        cookie: cookie || null,
      });
      set({ account: await refreshProfile(acc), isLoading: false, isModalOpen: false, error: null });
    } catch (e: any) {
      console.error('Failed to save custom account:', e);
      set({
        error: typeof e === 'string' ? e : e?.message || 'Failed to save account credentials',
        isLoading: false,
      });
    }
  },

  signInBrowser: async (clientId?: string, clientSecret?: string) => {
    set({ isLoading: true, error: null });
    try {
      const acc = await invoke<YTAccountInfo>('yt_auth_start_browser', {
        clientId: clientId || null,
        clientSecret: clientSecret || null,
      });
      set({ account: await refreshProfile(acc), isLoading: false, isModalOpen: false });
    } catch (e: any) {
      console.error('YouTube sign-in error:', e);
      set({
        error: typeof e === 'string' ? e : e?.message || 'Authentication failed',
        isLoading: false,
      });
    }
  },

  syncBrowserCookies: async (browser: string = 'chrome') => {
    set({ isLoading: true, error: null });
    try {
      const acc = await invoke<YTAccountInfo>('yt_auth_sync_browser_cookies', { browser });
      set({ account: await refreshProfile(acc), isLoading: false, isModalOpen: false });
    } catch (e: any) {
      console.error('Browser session sync error:', e);
      set({
        error: typeof e === 'string' ? e : e?.message || 'Sync failed',
        isLoading: false,
      });
    }
  },

  signOut: async () => {
    try {
      await invoke('yt_auth_logout');
      set({ account: null, isModalOpen: false, error: null });
    } catch (e) {
      console.error('Logout failed:', e);
    }
  },

  openWebLogin: async () => {
    try {
      await invoke('yt_auth_open_browser_url', { url: 'https://music.youtube.com' });
    } catch (e) {
      console.error('Failed to open browser:', e);
    }
  },
}));
