import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useLibraryStore } from './store/library';
import { useSearchStore } from './store/search';
import { usePlayerStore } from './store/player';
import { useThemeStore } from './store/theme';
import { LibraryView } from './views/LibraryView';
import { HomeView } from './views/HomeView';
import { SearchView } from './views/SearchView';
import { ExploreView } from './views/ExploreView';
import { OnlinePlaylistView } from './views/OnlinePlaylistView';
import { PlaylistsView } from './views/PlaylistsView';
import { AlbumsView } from './views/AlbumsView';

const SettingsView = React.lazy(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })));
const DownloadsView = React.lazy(() => import('./views/DownloadsView').then(m => ({ default: m.DownloadsView })));
const SpotifyImportView = React.lazy(() => import('./views/SpotifyImportView').then(m => ({ default: m.SpotifyImportView })));

import { PlayerBar } from './components/PlayerBar';
import { QueuePanel } from './components/Queue';
import { LyricsPanel } from './components/LyricsPanel';
import { FullscreenPlayer } from './components/FullscreenPlayer';
import { SearchBar } from './components/SearchBar';
import { ScanModal } from './components/ScanModal';
import { YTSignInModal } from './components/YTSignInModal';
import { ChooseLyricsProviderModal } from './components/ChooseLyricsProviderModal';
import { useYTAuthStore } from './store/ytauth';
import {
  House,
  Compass,
  Disc,
  Playlist,
  MusicNotes,
  MusicNote,
  X,
  Gear,
  Minus,
  SquaresFour,
  CircleNotch,
  SignIn,
  SignOut,
  SlidersHorizontal,
  CheckCircle,
  DownloadSimple,
  SpotifyLogo,
} from '@phosphor-icons/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useShallow } from 'zustand/react/shallow';
import './styles/tokens.css';
import './App.css';

export type ActivePanel = 'queue' | 'lyrics' | null;
type MainView = 'home' | 'explore' | 'library' | 'albums' | 'playlists' | 'online_playlist' | 'settings' | 'downloads' | 'spotify';

function App() {
  const { tracks } = useLibraryStore(useShallow(state => ({ tracks: state.tracks })));
  const { query, setQuery } = useSearchStore(useShallow(state => ({ query: state.query, setQuery: state.setQuery })));
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [activeMainView, setActiveMainView] = useState<MainView>('home');
  const [onlinePlaylistBackView, setOnlinePlaylistBackView] = useState<MainView>('explore');
  const [selectedOnlinePlaylistId, setSelectedOnlinePlaylistId] = useState<string | null>(null);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const { queue, currentIndex } = usePlayerStore(useShallow(state => ({ queue: state.queue, currentIndex: state.currentIndex })));
  const { themeMode, customAccent } = useThemeStore(useShallow(state => ({ themeMode: state.themeMode, customAccent: state.customAccent })));
  const currentTrackId = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex].id : null;
  const currentTrack = tracks.find(t => t.id === currentTrackId) || (currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null);
  const { account, openModal, signOut } = useYTAuthStore();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };
    if (isAccountMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isAccountMenuOpen]);

  useEffect(() => {
    useLibraryStore.getState().initArtworkPath();
    useLibraryStore.getState().loadTracks();
    useYTAuthStore.getState().init();
    
    // Check initial maximize state
    getCurrentWindow().isMaximized().then(setIsMaximized).catch(err => console.warn('isMaximized error:', err));
    
    // Listen for resize events to update maximize state
    let unlistenFn: (() => void) | null = null;
    getCurrentWindow().onResized(async () => {
      try {
        setIsMaximized(await getCurrentWindow().isMaximized());
      } catch (err) {
        console.warn('onResized check error:', err);
      }
    }).then(f => {
      unlistenFn = f;
    }).catch(err => console.warn('onResized error:', err));

    // The sign-in window closes when a login completes, so refresh the account when
    // the main window regains focus. This keeps the UI in sync even if the capture
    // event was missed.
    let unlistenFocus: (() => void) | null = null;
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) useYTAuthStore.getState().refresh();
    }).then(f => {
      unlistenFocus = f;
    }).catch(err => console.warn('onFocusChanged error:', err));

    return () => {
      if (unlistenFn) unlistenFn();
      if (unlistenFocus) unlistenFocus();
    };
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat) return; // Prevent continuous triggering for some keys

      const store = usePlayerStore.getState();
      
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (store.isPlaying) store.pause();
          else store.resume();
          break;
        case 'ArrowRight':
          e.preventDefault();
          store.next();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          store.prev();
          break;
        case 'ArrowUp':
          e.preventDefault();
          store.setVolume(Math.min(1, store.volume + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          store.setVolume(Math.max(0, store.volume - 0.1));
          break;
        case 'f':
        case 'F':
        case 'F11':
          e.preventDefault();
          setIsFullscreenOpen(prev => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    let accentHex = '#ffffff';
    if (themeMode === 'monochrome') {
      accentHex = '#ffffff';
    } else if (themeMode === 'dynamic' && currentTrack?.accent) {
      accentHex = currentTrack.accent;
    } else if (themeMode === 'custom') {
      accentHex = customAccent || '#ffffff';
    }

    const isLight = (hex: string) => {
      const c = hex.replace('#', '');
      if (c.length === 6) {
        const r = parseInt(c.slice(0, 2), 16);
        const g = parseInt(c.slice(2, 4), 16);
        const b = parseInt(c.slice(4, 6), 16);
        return (r * 299 + g * 587 + b * 114) / 1000 > 140;
      }
      return true;
    };

    const light = isLight(accentHex);
    const contrast = light ? '#000000' : '#ffffff';
    const hoverColor = light
      ? `color-mix(in srgb, ${accentHex} 85%, black)`
      : `color-mix(in srgb, ${accentHex} 85%, white)`;

    root.style.setProperty('--accent', accentHex);
    root.style.setProperty('--accent-contrast', contrast);
    root.style.setProperty('--accent-hover', hoverColor);
    root.style.setProperty('--accent-subtle', `color-mix(in srgb, ${accentHex} 15%, transparent)`);
    root.style.setProperty('--bg-glow', `color-mix(in srgb, ${accentHex} 5%, transparent)`);
    root.style.setProperty('--surface-selected', `color-mix(in srgb, ${accentHex} 20%, transparent)`);
  }, [currentTrack?.accent, themeMode, customAccent]);

  const togglePanel = (panel: 'queue' | 'lyrics') => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

  const handleToggleMaximize = async () => {
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
    setIsMaximized(await win.isMaximized());
  };

  const handleViewChange = (view: MainView) => {
    setActiveMainView(view);
    if (query) {
      setQuery('');
    }
  };

  return (
    <div className={`app-shell ${isMaximized ? 'is-maximized' : ''}`}>
      {/* 1. Window Header */}
      <header 
        data-tauri-drag-region 
        className="app-header"
      >
        <div data-tauri-drag-region className="brand-section">
          <span className="brand-mark" aria-hidden="true">
            <MusicNote size={12} weight="fill" />
          </span>
          <h1 className="brand-title" data-tauri-drag-region>Stave</h1>
        </div>

        <div className="header-center">
          <SearchBar />
        </div>

        <div className="header-actions">
          {/* Account Profile Tag & Dropdown */}
          <div className="account-anchor" ref={accountMenuRef}>
            <button
              className="header-avatar-btn"
              onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
              title={account?.is_authenticated ? account.name : 'Account'}
            >
              {account?.is_authenticated ? (
                <span className="header-avatar">
                  {(account.name || '?').charAt(0).toUpperCase()}
                </span>
              ) : (
                <span className="header-avatar header-avatar-guest">
                  <SignIn size={13} />
                </span>
              )}
              <span>{account?.is_authenticated ? account.name.split(' ')[0] : 'Sign in'}</span>
            </button>

            {isAccountMenuOpen && (
              <div className="account-menu">
                {account && account.is_authenticated ? (
                  <>
                    <div className="account-menu-header">
                      <div className="account-menu-name">
                        <span>{account.name}</span>
                        <CheckCircle size={14} weight="regular" color="#22c55e" />
                      </div>
                      {account.email && (
                        <div className="account-menu-email">{account.email}</div>
                      )}
                    </div>

                    <button
                      className="account-menu-item"
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        openModal();
                      }}
                    >
                      <SlidersHorizontal size={16} />
                      <span>Manage accounts</span>
                    </button>

                    <button
                      className="account-menu-item danger"
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        signOut();
                      }}
                    >
                      <SignOut size={16} />
                      <span>Sign out</span>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="account-menu-header">
                      <div className="account-menu-title">Not signed in</div>
                      <div className="account-menu-sub">Connect a YouTube Music profile</div>
                    </div>

                    <button
                      className="account-menu-item primary"
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        openModal();
                      }}
                    >
                      <SignIn size={16} weight="regular" />
                      <span>Sign in</span>
                    </button>

                    <button
                      className="account-menu-item"
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        openModal();
                      }}
                    >
                      <SlidersHorizontal size={16} />
                      <span>Manage accounts</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="window-controls">
            <div className="window-btn" title="Minimize" aria-label="Minimize" onClick={() => getCurrentWindow().minimize()}>
              <Minus size={16} />
            </div>
            <div className="window-btn" title="Maximize" aria-label="Maximize" onClick={handleToggleMaximize}>
              <SquaresFour size={14} />
            </div>
            <div className="window-btn close" title="Close" aria-label="Close" onClick={() => getCurrentWindow().close()}>
              <X size={16} />
            </div>
          </div>
        </div>
      </header>

      {/* 2. Body: Sidebar + Main + Inspector */}
      <div className="app-body">
        {/* Sidebar */}
        <aside className="app-sidebar" style={{ position: 'relative', zIndex: 2 }}>
          <div className="sidebar-section">
            <div className="sidebar-label">Browse</div>
            <button 
              className={`sidebar-item ${activeMainView === 'home' ? 'active' : ''}`}
              onClick={() => handleViewChange('home')}
            >
              <div className="sidebar-item-left">
                <House size={15} weight="bold" />
                <span>Home</span>
              </div>
            </button>
            <button
              className={`sidebar-item ${activeMainView === 'explore' ? 'active' : ''}`}
              onClick={() => handleViewChange('explore')}
            >
              <div className="sidebar-item-left">
                <Compass size={15} weight="bold" />
                <span>Explore</span>
              </div>
            </button>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Your library</div>
            <button 
              className={`sidebar-item ${activeMainView === 'library' ? 'active' : ''}`}
              onClick={() => handleViewChange('library')}
            >
              <div className="sidebar-item-left">
                <MusicNotes size={15} weight="bold" />
                <span>Songs</span>
              </div>
            </button>
            <button 
              className={`sidebar-item ${activeMainView === 'albums' ? 'active' : ''}`}
              onClick={() => handleViewChange('albums')}
            >
              <div className="sidebar-item-left">
                <Disc size={15} weight="bold" />
                <span>Albums</span>
              </div>
            </button>
            <button 
              className={`sidebar-item ${activeMainView === 'playlists' ? 'active' : ''}`}
              onClick={() => handleViewChange('playlists')}
            >
              <div className="sidebar-item-left">
                <Playlist size={15} weight="bold" />
                <span>Playlists</span>
              </div>
            </button>
            <button 
              className={`sidebar-item ${activeMainView === 'downloads' ? 'active' : ''}`}
              onClick={() => handleViewChange('downloads')}
            >
              <div className="sidebar-item-left">
                <DownloadSimple size={15} />
                <span>Downloads</span>
              </div>
            </button>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Services</div>
            <button 
              className={`sidebar-item ${activeMainView === 'spotify' ? 'active' : ''}`}
              onClick={() => handleViewChange('spotify')}
            >
              <div className="sidebar-item-left">
                <SpotifyLogo size={15} />
                <span>Spotify import</span>
              </div>
            </button>
          </div>

          <div style={{ flex: 1 }} />

          <div className="sidebar-footer">
            <button 
              className={`sidebar-item ${activeMainView === 'settings' ? 'active' : ''}`}
              onClick={() => handleViewChange('settings')}
            >
              <div className="sidebar-item-left">
                <Gear size={15} />
                <span>Settings</span>
              </div>
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="app-content" style={{ position: 'relative', zIndex: 1 }}>
          <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}><CircleNotch size={24} className="spinning-icon" /></div>}>
            {query ? <SearchView /> : (
              activeMainView === 'home' ? <HomeView onScanFolder={() => setIsScanModalOpen(true)} /> : 
              activeMainView === 'explore' ? (
                <ExploreView
                  onOpenPlaylist={(playlistId) => {
                    setSelectedOnlinePlaylistId(playlistId);
                    setOnlinePlaylistBackView('explore');
                    setActiveMainView('online_playlist');
                  }}
                />
              ) :
              activeMainView === 'library' ? (
                <LibraryView 
                  onScanFolder={() => setIsScanModalOpen(true)}
                />
              ) :
              activeMainView === 'playlists' ? (
                <PlaylistsView
                  onOpenOnlinePlaylist={(playlistId) => {
                    setSelectedOnlinePlaylistId(playlistId);
                    setOnlinePlaylistBackView('playlists');
                    setActiveMainView('online_playlist');
                  }}
                />
              ) :
              activeMainView === 'albums' ? (
                <AlbumsView />
              ) : 
              activeMainView === 'online_playlist' ? (
                <OnlinePlaylistView
                  initialPlaylistId={selectedOnlinePlaylistId}
                  onBack={() => setActiveMainView(onlinePlaylistBackView)}
                />
              ) :
              activeMainView === 'downloads' ? <DownloadsView /> :
              activeMainView === 'spotify' ? <SpotifyImportView /> :
              <SettingsView />
            )}
          </Suspense>
        </main>

        {/* Up Next / Lyrics / EQ Drawer */}
        {activePanel && (
          <aside className="app-inspector">
            <div className="inspector-header">
              <div className="inspector-segmented">
                <button
                  className={`inspector-seg-btn ${activePanel === 'queue' ? 'active' : ''}`}
                  onClick={() => setActivePanel('queue')}
                >
                  Queue
                </button>
                <button
                  className={`inspector-seg-btn ${activePanel === 'lyrics' ? 'active' : ''}`}
                  onClick={() => setActivePanel('lyrics')}
                >
                  Lyrics
                </button>
              </div>

              <button className="btn-icon" onClick={() => setActivePanel(null)} title="Close panel">
                <X size={15} />
              </button>
            </div>

            <div className="inspector-body">
              {activePanel === 'queue' && <QueuePanel />}
              {activePanel === 'lyrics' && <LyricsPanel />}
            </div>
          </aside>
        )}
      </div>

      {/* 3. Bottom Player Bar */}
      <PlayerBar 
        activePanel={activePanel} 
        onTogglePanel={togglePanel} 
        onOpenFullscreen={() => setIsFullscreenOpen(true)}
      />

      <FullscreenPlayer 
        isOpen={isFullscreenOpen} 
        onClose={() => setIsFullscreenOpen(false)} 
      />

      {/* 4. Modals */}
      <ScanModal isOpen={isScanModalOpen} onClose={() => setIsScanModalOpen(false)} />
      <YTSignInModal />
      <ChooseLyricsProviderModal />
    </div>
  );
}

export default App;
