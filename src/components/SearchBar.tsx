import { useRef, useEffect, useState } from 'react';
import { useSearchStore } from '../store/search';
import { MagnifyingGlass, X, CircleNotch } from '@phosphor-icons/react';

export function SearchBar() {
  const { query, setQuery, isSearching } = useSearchStore();
  const [localQuery, setLocalQuery] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync down from store
  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  // Debounce up to store
  useEffect(() => {
    const handler = setTimeout(() => {
      if (query !== localQuery) setQuery(localQuery);
    }, 150);
    return () => clearTimeout(handler);
  }, [localQuery, query, setQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="search-wrapper">
      <div className="search-icon-left">
        {isSearching ? (
          <CircleNotch size={16} className="spinning-icon" color="var(--accent)" />
        ) : (
          <MagnifyingGlass size={16} />
        )}
      </div>
      <input
        ref={inputRef}
        type="text"
        className="search-input"
        placeholder="Search tracks, artists, albums..."
        value={localQuery}
        onChange={(e) => setLocalQuery(e.target.value)}
      />
      {localQuery ? (
        <button
          className="btn-icon"
          style={{ position: 'absolute', right: 8, width: 24, height: 24 }}
          onClick={() => {
            setLocalQuery('');
            setQuery('');
            inputRef.current?.focus();
          }}
          title="Clear search"
        >
          <X size={14} />
        </button>
      ) : (
        <span className="search-shortcut-badge">Ctrl+K</span>
      )}
    </div>
  );
}
