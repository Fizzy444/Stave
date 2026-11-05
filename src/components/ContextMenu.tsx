import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../store/library';
import { isYouTubeTrack, extractYouTubeId, usePlayerStore } from '../store/player';
import { getYouTubeRadio, ytItemToTrack } from '../store/ytmusic';
import { DownloadSimple, Broadcast, LinkSimple, Play, Plus } from '@phosphor-icons/react';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  divider?: boolean;
  danger?: boolean;
}

export function getQueueContextMenuItems(track: Track): ContextMenuItem[] {
  return [
    {
      label: 'Play next',
      icon: <Play size={14} />,
      onClick: () => {
        usePlayerStore.getState().playNext(track);
      },
    },
    {
      label: 'Add to queue',
      icon: <Plus size={14} />,
      onClick: () => {
        usePlayerStore.getState().addToQueue(track);
      },
    },
  ];
}

export function getYouTubeContextMenuItems(track: Track): ContextMenuItem[] {
  if (!isYouTubeTrack(track)) return [];
  const videoId = extractYouTubeId(track);
  if (!videoId) return [];

  return [
    {
      label: 'Start radio',
      icon: <Broadcast size={15} />,
      onClick: async () => {
        try {
          const recs = await getYouTubeRadio(videoId);
          if (recs && recs.length > 0) {
            const tracks = recs.map(ytItemToTrack);
            await usePlayerStore.getState().playRadio(videoId, tracks);
          }
        } catch (err) {
          console.error('Failed to start YouTube radio:', err);
        }
      },
    },
    {
      label: 'Download',
      icon: <DownloadSimple size={15} />,
      onClick: async () => {
        try {
          await invoke('queue_download', {
            id: videoId,
            title: track.title || 'Unknown title',
            artist: track.artist || 'Unknown artist',
          });
        } catch (err) {
          console.error('Failed to queue download:', err);
        }
      },
    },
    {
      label: 'Copy link',
      icon: <LinkSimple size={15} />,
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${videoId}`);
        } catch (err) {
          console.error('Failed to copy YouTube link:', err);
        }
      },
    },
  ];
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items?: ContextMenuItem[];
  track?: Track | null;
  onClose: () => void;
}

export function ContextMenu({ x, y, items = [], track, onClose }: ContextMenuProps) {
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

  const ytItems = track ? getYouTubeContextMenuItems(track) : [];
  
  // If track is a YouTube track and items are provided, filter out the song info editor if present
  let baseItems = items;
  if (track && isYouTubeTrack(track)) {
    baseItems = baseItems.filter(item => !item.label?.toLowerCase().includes('song info'));
  }

  const finalItems: ContextMenuItem[] = [...baseItems];
  if (ytItems.length > 0) {
    if (finalItems.length > 0) {
      finalItems.push({ divider: true, label: '', onClick: () => {} });
    }
    finalItems.push(...ytItems);
  }

  // Ensure menu stays within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(y, Math.max(10, window.innerHeight - (finalItems.length * 32 + 24))),
    left: Math.min(x, Math.max(10, window.innerWidth - 220)),
  };

  return (
    <div ref={menuRef} className="context-menu" style={style} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      {finalItems.map((item, i) => (
        item.divider ? (
          <div key={`divider-${i}`} className="context-menu-divider" />
        ) : (
          <div
            key={i}
            className={`context-menu-item ${item.danger ? 'danger' : ''}`}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </div>
        )
      ))}
    </div>
  );
}
