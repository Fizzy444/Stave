import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  divider?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    
    // Use timeout to prevent immediate close if the click that opened this also fires a document click
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('contextmenu', handleClickOutside);
    }, 0);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('contextmenu', handleClickOutside);
    };
  }, [onClose]);

  // Ensure menu stays within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(y, window.innerHeight - (items.length * 32 + 16)),
    left: Math.min(x, window.innerWidth - 200),
    width: 200,
    backgroundColor: 'rgba(30, 30, 30, 0.95)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid var(--divider)',
    borderRadius: '6px',
    padding: '4px 0',
    zIndex: 9999,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    display: 'flex',
    flexDirection: 'column'
  };

  return (
    <div ref={menuRef} style={style} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      {items.map((item, i) => (
        item.divider ? (
          <div key={`divider-${i}`} style={{ height: 1, backgroundColor: 'var(--divider)', margin: '4px 0' }} />
        ) : (
          <div
            key={i}
            className="context-menu-item"
            style={{
              padding: '6px 12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              color: item.danger ? '#ef4444' : 'var(--text-primary)',
              transition: 'background-color 0.1s'
            }}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            {item.icon}
            {item.label}
          </div>
        )
      ))}
    </div>
  );
}
