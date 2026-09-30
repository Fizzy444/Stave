import React, { useState, useEffect, Suspense } from 'react';
import { useLibraryStore } from './store/library';
import { useSearchStore } from './store/search';
import { usePlayerStore } from './store/player';
import { useThemeStore } from './store/theme';
import { LibraryView } from './views/LibraryView';
import { HomeView } from './views/HomeView';
import { SearchView } from './views/SearchView';
import { PlaylistsView } from './views/PlaylistsView';

const SettingsView = React.lazy(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })));
const DownloadsView = React.lazy(() => import('./views/DownloadsView').then(m => ({ default: m.DownloadsView })));
const SpotifyImportView = React.lazy(() => import('./views/SpotifyImportView').then(m => ({ default: m.SpotifyImportView })));

import { PlayerBar } from './components/PlayerBar';
import { QueuePanel } from './components/Queue';
import { LyricsPanel } from './components/LyricsPanel';
import { FullscreenPlayer } from './components/FullscreenPlayer';
import { SearchBar } from './components/SearchBar';
import { ScanModal } from './components/ScanModal';
import {
  MusicNotes,
  House,
  FolderSimplePlus,
  X,
  Gear,
  DownloadSimple,
  SpotifyLogo,
  Minus,
  SquaresFour,
  Playlist,
  CircleNotch
} from '@phosphor-icons/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useShallow } from 'zustand/react/shallow';
import './styles/tokens.css';
import './App.css';

export type ActivePanel = 'queue' | 'lyrics' | null;

function App() {
  const { tracks } = useLibraryStore(useShallow(state => ({ tracks: state.tracks })));
  const { query, setQuery } = useSearchStore(useShallow(state => ({ query: state.query, setQuery: state.setQuery })));
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [activeMainView, setActiveMainView] = useState<'home' | 'library' | 'playlists' | 'settings' | 'downloads' | 'spotify'>('home');
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const { queue, currentIndex } = usePlayerStore(useShallow(state => ({ queue: state.queue, currentIndex: state.currentIndex })));
  const { themeMode, customAccent } = useThemeStore(useShallow(state => ({ themeMode: state.themeMode, customAccent: state.customAccent })));
  
  const currentTrackId = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex].id : null;
  const currentTrack = tracks.find(t => t.id === currentTrackId) || (currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null);

  useEffect(() => {
    useLibraryStore.getState().initArtworkPath();
    
    // Check initial maximize state
    getCurrentWindow().isMaximized().then(setIsMaximized);
    
    // Listen for resize events to update maximize state
    const unlisten = getCurrentWindow().onResized(async () => {
      setIsMaximized(await getCurrentWindow().isMaximized());
    });
    
    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // Dynamic Theme Injection
  useEffect(() => {
    const root = document.documentElement;
    
    let accentHex = '#007aff'; // default fallback
    
    if (themeMode === 'dynamic' && currentTrack?.accent) {
      accentHex = currentTrack.accent;
    } else if (themeMode === 'custom') {
      accentHex = customAccent;
    }

    root.style.setProperty('--accent', accentHex);
    root.style.setProperty('--accent-hover', `color-mix(in srgb, ${accentHex} 85%, white)`);
    root.style.setProperty('--accent-subtle', `color-mix(in srgb, ${accentHex} 15%, transparent)`);
    root.style.setProperty('--bg-glow', `color-mix(in srgb, ${accentHex} 5%, transparent)`);
    root.style.setProperty('--surface-selected', `color-mix(in srgb, ${accentHex} 25%, transparent)`);
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

  const handleViewChange = (view: typeof activeMainView) => {
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
          <h1 className="brand-title" data-tauri-drag-region>Stave</h1>
        </div>

        <div className="header-center">
          <SearchBar />
        </div>

        <div className="header-actions">

          <div className="window-controls">
            <div className="window-btn" onClick={() => getCurrentWindow().minimize()}>
              <Minus size={16} />
            </div>
            <div className="window-btn" onClick={handleToggleMaximize}>
              <SquaresFour size={14} />
            </div>
            <div className="window-btn close" onClick={() => getCurrentWindow().close()}>
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
            <div className="sidebar-label">Library</div>
            <button 
              className={`sidebar-item ${activeMainView === 'home' ? 'active' : ''}`}
              onClick={() => handleViewChange('home')}
            >
              <div className="sidebar-item-left">
                <House size={16} weight="bold" />
                <span>Home</span>
              </div>
            </button>
            <button 
              className={`sidebar-item ${activeMainView === 'library' ? 'active' : ''}`}
              onClick={() => handleViewChange('library')}
            >
              <div className="sidebar-item-left">
                <MusicNotes size={16} weight="bold" />
                <span>Library</span>
              </div>
              <span className="sidebar-badge">{tracks.length}</span>
            </button>
            <button 
              className={`sidebar-item ${activeMainView === 'playlists' ? 'active' : ''}`}
              onClick={() => handleViewChange('playlists')}
            >
              <div className="sidebar-item-left">
                <Playlist size={16} weight="bold" />
                <span>Playlists</span>
              </div>
            </button>
          </div>

          <div style={{ flex: 1 }} />

          <div className="sidebar-section">
            <div className="sidebar-label">Sources</div>
            <button 
              className={`sidebar-item ${activeMainView === 'downloads' ? 'active' : ''}`}
              onClick={() => handleViewChange('downloads')}
            >
              <div className="sidebar-item-left">
                <DownloadSimple size={16} />
                <span>Downloads</span>
              </div>
            </button>
            <button 
              className={`sidebar-item ${activeMainView === 'spotify' ? 'active' : ''}`}
              onClick={() => handleViewChange('spotify')}
            >
              <div className="sidebar-item-left">
                <SpotifyLogo size={16} />
                <span>Import Spotify</span>
              </div>
            </button>
            <button className="sidebar-item" onClick={() => setIsScanModalOpen(true)}>
              <div className="sidebar-item-left">
                <FolderSimplePlus size={16} />
                <span>Scan Folder</span>
              </div>
            </button>
            <button 
              className={`sidebar-item ${activeMainView === 'settings' ? 'active' : ''}`}
              onClick={() => handleViewChange('settings')}
            >
              <div className="sidebar-item-left">
                <Gear size={16} />
                <span>Settings</span>
              </div>
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="app-content" style={{ position: 'relative', zIndex: 1 }} key={activeMainView + (query ? 'search' : '')}>
          <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}><CircleNotch size={24} className="spinning-icon" /></div>}>
            {query ? <SearchView /> : (
              activeMainView === 'home' ? <HomeView /> : 
              activeMainView === 'library' ? <LibraryView /> : 
              activeMainView === 'playlists' ? <PlaylistsView /> : 
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
                  Up Next
                </button>
                <button
                  className={`inspector-seg-btn ${activePanel === 'lyrics' ? 'active' : ''}`}
                  onClick={() => setActivePanel('lyrics')}
                >
                  Lyrics
                </button>
              </div>

              <button className="btn-icon" onClick={() => setActivePanel(null)} title="Close Panel">
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
    </div>
  );
}

export default App;
