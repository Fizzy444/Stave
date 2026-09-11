import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MagnifyingGlass, DownloadSimple, CircleNotch } from '@phosphor-icons/react';

type YTSearchResult = {
  id: string;
  title: string;
  artist: string;
  duration: number;
};

export function DownloadsView() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<YTSearchResult[]>([]);
  const [activeTab, setActiveTab] = useState<'search' | 'active' | 'completed'>('search');
  
  const [downloads, setDownloads] = useState<any[]>([]);

  useEffect(() => {
    let interval: number;
    if (activeTab === 'active' || activeTab === 'completed') {
      const fetchDownloads = async () => {
        try {
          const res = await invoke<any[]>('get_downloads');
          setDownloads(res);
        } catch (e) {
          console.error(e);
        }
      };
      fetchDownloads();
      interval = window.setInterval(fetchDownloads, 2000);
    }
    return () => clearInterval(interval);
  }, [activeTab]);

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
      setActiveTab('active');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="view-header" style={{ flexShrink: 0, padding: '48px 32px 0 32px' }}>
        <h2 style={{ fontSize: '32px', fontWeight: 700, margin: 0, color: 'var(--text-primary)', letterSpacing: '-1px' }}>
          Downloads
        </h2>
        
        <div style={{ display: 'flex', gap: '32px', marginTop: '24px', borderBottom: '1px solid var(--divider)', padding: '0 32px' }}>
          {[
            { id: 'search', label: 'Search' },
            { id: 'active', label: 'Active' },
            { id: 'completed', label: 'Completed' }
          ].map(tab => (
            <div 
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                cursor: 'pointer', 
                fontSize: '14px', 
                fontWeight: activeTab === tab.id ? 700 : 500, 
                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                borderBottom: activeTab === tab.id ? '2px solid var(--text-primary)' : '2px solid transparent',
                paddingBottom: '12px',
                marginBottom: '-1px',
                transition: 'color 0.2s'
              }}
            >
              {tab.label}
            </div>
          ))}
        </div>
      </div>

      <div className="view-content" style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'search' && (
          <div style={{ padding: '0 32px' }}>
            <form onSubmit={handleSearch} style={{ position: 'relative', marginBottom: '24px' }}>
              <MagnifyingGlass 
                size={20} 
                style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}
              />
              <input 
                type="text"
                placeholder="Search YouTube for tracks..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '16px 16px 16px 48px',
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--divider)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '15px',
                  outline: 'none'
                }}
              />
            </form>

            {isSearching && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
                <CircleNotch size={24} className="spinning-icon" />
              </div>
            )}

            {!isSearching && results.map(res => (
              <div key={res.id} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px',
                borderBottom: '1px solid var(--divider)'
              }}>
                <div>
                  <div style={{ fontSize: '15px', color: 'var(--text-primary)', fontWeight: 500 }}>
                    {res.title}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {res.artist} &bull; {Math.floor(res.duration / 60)}:{String(res.duration % 60).padStart(2, '0')}
                  </div>
                </div>
                <button 
                  onClick={() => handleDownload(res.id, res.title, res.artist)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 16px',
                    backgroundColor: 'var(--accent)',
                    color: '#000',
                    border: 'none',
                    borderRadius: '4px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <DownloadSimple size={16} />
                  Download
                </button>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'active' && (
          <div style={{ padding: '0 32px' }}>
            {downloads.filter(d => d.status === 'downloading' || d.status === 'queued').length === 0 ? (
              <div className="empty-library-state">
                <div style={{ color: 'var(--text-secondary)' }}>No active downloads.</div>
              </div>
            ) : (
              downloads.filter(d => d.status === 'downloading' || d.status === 'queued').map(res => (
                <div key={res.id} style={{ padding: '16px', borderBottom: '1px solid var(--divider)' }}>
                  <div style={{ fontSize: '15px', color: 'var(--text-primary)', fontWeight: 500 }}>
                    {res.title || res.id}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CircleNotch size={14} className="spinning-icon" /> {res.status} &bull; {res.artist || 'Unknown Artist'}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'completed' && (
          <div style={{ padding: '0 32px' }}>
            {downloads.filter(d => d.status === 'completed' || d.status === 'failed').length === 0 ? (
              <div className="empty-library-state">
                <div style={{ color: 'var(--text-secondary)' }}>No completed downloads.</div>
              </div>
            ) : (
              downloads.filter(d => d.status === 'completed' || d.status === 'failed').map(res => (
                <div key={res.id} style={{ padding: '16px', borderBottom: '1px solid var(--divider)' }}>
                  <div style={{ fontSize: '15px', color: 'var(--text-primary)', fontWeight: 500 }}>
                    {res.title || res.id}
                  </div>
                  <div style={{ fontSize: '13px', color: res.status === 'failed' ? '#f87171' : 'var(--text-secondary)', marginTop: '4px' }}>
                    {res.status === 'completed' ? 'Completed' : 'Failed'} &bull; {res.artist || 'Unknown Artist'}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
