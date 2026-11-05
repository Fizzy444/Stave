import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLyricsStore, LYRICS_PROVIDERS } from '../store/lyrics';
import { usePlayerStore } from '../store/player';
import { Check, MagnifyingGlass, X, CircleNotch } from '@phosphor-icons/react';

export function ChooseLyricsProviderModal() {
  const {
    isModalOpen,
    closeModal,
    currentProvider,
    providerStatuses,
    activeTrack,
    selectProvider,
    fetchProvider,
  } = useLyricsStore();

  const playerTrack = usePlayerStore((s) =>
    s.currentIndex >= 0 && s.currentIndex < s.queue.length ? s.queue[s.currentIndex] : null
  );
  const trackToUse = activeTrack || playerTrack;

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, closeModal]);

  if (!isModalOpen) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onClick={closeModal}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '460px',
          maxWidth: '92vw',
          maxHeight: '85vh',
          backgroundColor: 'var(--surface-overlay)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
          boxShadow: '0 20px 48px rgba(0, 0, 0, 0.85)',
          border: '1px solid var(--border-contrast)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          backdropFilter: 'blur(20px)'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-system)' }}>
              Lyrics
            </h3>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-system)', marginTop: '2px' }}>
              Choose where Stave looks for lyrics.
            </div>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={closeModal}
            style={{ width: '28px', height: '28px', borderRadius: '50%' }}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Providers List */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            overflowY: 'auto',
            maxHeight: '60vh',
            paddingRight: '4px',
          }}
        >
          {LYRICS_PROVIDERS.map((provider) => {
            const statusInfo = providerStatuses[provider.id] || { status: 'idle' };
            const isCurrent = currentProvider === provider.id;
            const isFound = statusInfo.status === 'found';
            const isLoading = statusInfo.status === 'loading';
            const isNotFound = statusInfo.status === 'not_found';

            let subtitle = 'Search';
            let subtitleColor = 'var(--text-tertiary)';

            if (isLoading) {
              subtitle = 'Searching…';
              subtitleColor = 'var(--accent)';
            } else if (isCurrent && isFound) {
              subtitle = 'Selected · Lyrics found';
              subtitleColor = '#ffffff';
            } else if (isCurrent && isNotFound) {
              subtitle = 'Selected · No lyrics found';
              subtitleColor = '#ef4444';
            } else if (isCurrent) {
              subtitle = 'Selected';
              subtitleColor = '#ffffff';
            } else if (isFound) {
              subtitle = 'Lyrics found · Select';
              subtitleColor = 'var(--text-secondary)';
            } else if (isNotFound) {
              subtitle = 'No lyrics found';
              subtitleColor = 'var(--text-tertiary)';
            }

            const handleClick = () => {
              if (isLoading) return;
              if (isFound) {
                selectProvider(provider.id);
                closeModal();
              } else {
                fetchProvider(provider.id, trackToUse);
              }
            };

            return (
              <div
                key={provider.id}
                onClick={handleClick}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: isCurrent
                    ? 'var(--surface-selected)'
                    : 'var(--surface-element)',
                  border: isCurrent
                    ? '1px solid var(--accent)'
                    : '1px solid var(--border-subtle)',
                  cursor: isLoading ? 'default' : 'pointer',
                  userSelect: 'none',
                  transition: 'all var(--dur-fast)'
                }}
              >
                {/* Status Icon */}
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: (isCurrent && isFound) || isFound
                      ? 'rgba(16, 185, 129, 0.15)'
                      : isNotFound
                      ? 'rgba(239, 68, 68, 0.12)'
                      : 'var(--surface-panel)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    color: (isCurrent && isFound) || isFound
                      ? 'var(--accent-hi-res)'
                      : isNotFound
                      ? '#ef4444'
                      : isLoading
                      ? 'var(--accent)'
                      : 'var(--text-tertiary)',
                  }}
                >
                  {isLoading ? (
                    <CircleNotch size={14} className="spinning-icon" />
                  ) : (isCurrent && isFound) || isFound ? (
                    <Check size={14} weight="bold" />
                  ) : isNotFound ? (
                    <X size={14} />
                  ) : (
                    <MagnifyingGlass size={14} />
                  )}
                </div>

                {/* Text details */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-system)',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: isCurrent ? '#ffffff' : 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {provider.name}
                  </span>
                  <span style={{ fontFamily: 'var(--font-system)', fontSize: '10.5px', color: subtitleColor }}>
                    {subtitle}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
