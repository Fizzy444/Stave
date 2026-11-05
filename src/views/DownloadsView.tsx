import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MagnifyingGlass, DownloadSimple, CircleNotch, X, Trash, MusicNote } from '@phosphor-icons/react';
import { handleThumbnailError } from '../utils/thumbnail';

type YTSearchResult = {
  id: string;
  title: string;
  artist: string;
  duration: number;
};

type DownloadEntry = {
  id: string;
  title?: string;
  artist?: string;
  status: string;
};

const formatDuration = (seconds: number) => {
  if (!seconds || Number.isNaN(seconds)) return '--:--';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};

const statusLabel: Record<string, string> = {
  downloading: 'Downloading',
  queued: 'Waiting',
  completed: 'Downloaded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function DownloadsView() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<YTSearchResult[]>([]);
  const [activeTab, setActiveTab] = useState<'search' | 'active' | 'completed'>('search');
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);

  useEffect(() => {
    const fetchDownloads = async () => {
      try {
        const res = await invoke<DownloadEntry[]>('get_downloads');
        setDownloads(res);
      } catch (e) {
        console.error(e);
      }
    };
    fetchDownloads();
    const interval = window.setInterval(fetchDownloads, 2000);
    return () => clearInterval(interval);
  }, []);

  const activeDownloads = downloads.filter(d => d.status === 'downloading' || d.status === 'queued');
  const finishedDownloads = downloads.filter(d => d.status === 'completed' || d.status === 'failed' || d.status === 'cancelled');

  const handleCancel = async (id: string) => {
    try {
      await invoke('cancel_download', { id });
      setDownloads(downloads.map(d => d.id === id ? { ...d, status: 'cancelled' } : d));
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearLog = async () => {
    try {
      await invoke('clear_downloads_log');
      setDownloads(activeDownloads);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    setResults([]);
    try {
      const res = await invoke<YTSearchResult[]>('search_youtube', { query });
      setResults(res);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  const handleDownload = async (id: string, title: string, artist: string) => {
    try {
      await invoke('queue_download', { id, title, artist });
    } catch (e) {
      console.error(e);
    }
  };

  const tabs = [
    { id: 'search' as const, label: 'Find music' },
    { id: 'active' as const, label: activeDownloads.length > 0 ? `Downloading (${activeDownloads.length})` : 'Downloading' },
    { id: 'completed' as const, label: 'History' },
  ];

  return (
    <div className="view-container downloads-view">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">Downloads</h1>
          <p className="page-subtitle">Save music for offline listening.</p>
        </div>
      </header>

      <div className="downloads-toolbar">
        <div className="moods-genres-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`moods-genres-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="view-content downloads-body">
        {activeTab === 'search' && (
          <div className="downloads-search-panel">
            <form onSubmit={handleSearch} className="downloads-search">
              <MagnifyingGlass size={16} />
              <input
                className="downloads-search-input"
                type="text"
                placeholder="Search for a song to download"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </form>

            {isSearching && (
              <div className="inline-loading">
                <CircleNotch size={18} className="spinning-icon" />
                <span>Searching…</span>
              </div>
            )}

            {!isSearching && query.trim() && results.length === 0 && (
              <div className="inline-empty">No results. Try a different search.</div>
            )}

            {!isSearching && results.length > 0 && (
              <div className="download-results">
                {results.map(res => (
                  <div key={res.id} className="download-result-row">
                    <div className="download-result-art">
                      <img
                        src={`https://i.ytimg.com/vi/${res.id}/mqdefault.jpg`}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={handleThumbnailError}
                      />
                    </div>
                    <div className="download-result-info">
                      <div className="download-result-title" title={res.title}>{res.title}</div>
                      <div className="download-result-meta">
                        {res.artist || 'Unknown artist'}
                        {res.duration ? ` · ${formatDuration(res.duration)}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownload(res.id, res.title, res.artist)}
                      className="btn-secondary"
                    >
                      <DownloadSimple size={14} />
                      <span>Download</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!isSearching && !query.trim() && (
              <div className="inline-empty">Search YouTube Music to download a song to your library.</div>
            )}
          </div>
        )}

        {activeTab === 'active' && (
          <div className="download-list">
            {activeDownloads.length === 0 ? (
              <div className="inline-empty">Nothing is downloading right now.</div>
            ) : (
              activeDownloads.map(res => (
                <div key={res.id} className="download-row">
                  <div className="download-row-icon">
                    <CircleNotch size={15} className="spinning-icon" />
                  </div>
                  <div className="download-row-info">
                    <div className="download-row-title" title={res.title || res.id}>
                      {res.title || res.id}
                    </div>
                    <div className="download-row-meta">
                      {statusLabel[res.status] || res.status} · {res.artist || 'Unknown artist'}
                    </div>
                  </div>
                  <button
                    onClick={() => handleCancel(res.id)}
                    className="btn-icon"
                    title="Cancel download"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'completed' && (
          <div className="download-list">
            {finishedDownloads.length === 0 ? (
              <div className="inline-empty">Finished downloads appear here.</div>
            ) : (
              <>
                <div className="downloads-list-header">
                  <span>Recent downloads</span>
                  <button onClick={handleClearLog} className="btn-secondary">
                    <Trash size={14} />
                    <span>Clear history</span>
                  </button>
                </div>
                {finishedDownloads.map(res => (
                  <div key={res.id} className="download-row">
                    <div className="download-row-icon">
                      <MusicNote size={15} />
                    </div>
                    <div className="download-row-info">
                      <div className="download-row-title" title={res.title || res.id}>
                        {res.title || res.id}
                      </div>
                      <div className={`download-row-meta ${res.status === 'failed' ? 'is-error' : ''}`}>
                        {statusLabel[res.status] || res.status} · {res.artist || 'Unknown artist'}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
