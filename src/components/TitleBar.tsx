import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, SquaresFour, X } from '@phosphor-icons/react';
import './TitleBar.css';

export function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div data-tauri-drag-region className="titlebar">
      <div data-tauri-drag-region className="titlebar-title">
        Stave
      </div>
      <div className="titlebar-actions">
        <div 
          className="titlebar-button" 
          onClick={() => appWindow.minimize()}
        >
          <Minus size={16} />
        </div>
        <div 
          className="titlebar-button" 
          onClick={() => appWindow.toggleMaximize()}
        >
          <SquaresFour size={14} />
        </div>
        <div 
          className="titlebar-button titlebar-close" 
          onClick={() => appWindow.hide()}
        >
          <X size={16} />
        </div>
      </div>
    </div>
  );
}
