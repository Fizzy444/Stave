import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { CircleNotch, DownloadSimple, CheckCircle, Palette, Faders, Wrench, MusicNotes, ArrowClockwise, Lightning, CloudArrowDown } from '@phosphor-icons/react';
import { EqPanel } from '../components/EqPanel';
import { useThemeStore } from '../store/theme';

// --- Reusable Setting Components ---

const SettingCard = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{
    backgroundColor: 'oklch(0.22 0 0 / 0.6)',
    border: '1px solid var(--divider)',
    borderRadius: '12px',
    padding: '20px 24px',
    ...style,
  }}>
    {children}
  </div>
);

const SettingRow = ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '24px',
    minHeight: '40px',
  }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>{label}</div>
      {description && <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px', lineHeight: 1.4 }}>{description}</div>}
    </div>
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
      {children}
    </div>
  </div>
);

const Divider = () => <div style={{ height: '1px', backgroundColor: 'var(--divider-subtle)', margin: '12px 0' }} />;

const SectionTitle = ({ icon, title }: { icon: React.ReactNode; title: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
    <div style={{ color: 'var(--accent)', display: 'flex' }}>{icon}</div>
    <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{title}</h3>
  </div>
);

const SegmentedControl = ({ options, value, onChange }: { options: { label: string; value: string }[]; value: string; onChange: (v: string) => void }) => (
  <div style={{
    display: 'inline-flex',
    backgroundColor: 'oklch(0.18 0 0)',
    borderRadius: '8px',
    padding: '3px',
    gap: '2px',
    border: '1px solid var(--divider-subtle)',
  }}>
    {options.map(opt => (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        style={{
          padding: '6px 14px',
          borderRadius: '6px',
          border: 'none',
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.2s var(--ease)',
          backgroundColor: value === opt.value ? 'var(--accent)' : 'transparent',
          color: value === opt.value ? '#000' : 'var(--text-tertiary)',
        }}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

// --- Nav Item ---

const NavItem = ({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '9px 14px',
      borderRadius: '8px',
      background: active ? 'var(--surface-selected)' : 'transparent',
      color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
      border: 'none',
      cursor: 'pointer',
      textAlign: 'left',
      fontSize: '13px',
      fontWeight: active ? 600 : 500,
      transition: 'all 0.15s var(--ease)',
      width: '100%',
    }}
  >
    {icon}
    {label}
  </button>
);

// --- Main View ---

function hslToHex(h: number, s: number, l: number) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function SettingsView() {
  const { themeMode, customAccent, setThemeMode, setCustomAccent } = useThemeStore();
  const [toolsInstalled, setToolsInstalled] = useState<boolean | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<'appearance' | 'audio' | 'tools' | 'library' | 'updates'>('appearance');
  const [isFixing, setIsFixing] = useState(false);
  const [fixResult, setFixResult] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [hue, setHue] = useState(180);
  const [sat, setSat] = useState(90);
  const [light, setLight] = useState(60);

  useEffect(() => {
    checkTools();
  }, []);

  const checkTools = async () => {
    try {
      const result = await invoke<boolean>('check_tools');
      setToolsInstalled(result);
    } catch (e) {
      console.error('Failed to check tools:', e);
    }
  };

  const handleDownloadTools = async () => {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      await invoke('download_tools');
      await checkTools();
    } catch (e: any) {
      setDownloadError(e.toString());
      console.error(e);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFixMetadata = async (forceAll: boolean) => {
    setIsFixing(true);
    setFixResult("Processing... This may take a while depending on your library size.");
    try {
      const updatedCount = await invoke<number>('auto_fix_metadata', { forceAll });
      setFixResult(`Successfully updated metadata for ${updatedCount} tracks!`);
    } catch (e: any) {
      setFixResult(`Error: ${e.toString()}`);
    } finally {
      setIsFixing(false);
    }
  };

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const update = await check();
      if (update) {
        const yes = await ask(`Update to ${update.version} is available!\n\nRelease notes:\n${update.body}\n\nDownload and install now?`, {
          title: 'Update Available',
          kind: 'info',
        });
        if (yes) {
          await update.downloadAndInstall();
          await message('Update installed successfully. Please restart Stave to apply changes.', { title: 'Update Complete', kind: 'info' });
        }
      } else {
        await message('You are on the latest version.', { title: 'No Updates', kind: 'info' });
      }
    } catch (e: any) {
      console.error(e);
      await message(`Failed to check for updates: ${e}`, { title: 'Error', kind: 'error' });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const presetColors = [
    { color: '#ff5500', name: 'Orange' },
    { color: '#10b981', name: 'Green' },
    { color: '#3b82f6', name: 'Blue' },
    { color: '#8b5cf6', name: 'Purple' },
    { color: '#f43f5e', name: 'Rose' },
    { color: '#eab308', name: 'Gold' },
  ];

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="view-header" style={{ flexShrink: 0, padding: '40px 32px 0 32px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 700, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
          Settings
        </h2>
        <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px', fontWeight: 500 }}>
          Customize your experience
        </div>
      </div>

      <div className="view-content" style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: '24px 0 0 0' }}>

        {/* Settings Nav */}
        <div style={{
          width: '200px',
          padding: '0 0 0 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          flexShrink: 0,
        }}>
          <NavItem icon={<Palette size={16} />} label="Appearance" active={activeCategory === 'appearance'} onClick={() => setActiveCategory('appearance')} />
          <NavItem icon={<Faders size={16} />} label="Audio" active={activeCategory === 'audio'} onClick={() => setActiveCategory('audio')} />
          <NavItem icon={<MusicNotes size={16} />} label="Library" active={activeCategory === 'library'} onClick={() => setActiveCategory('library')} />
          <NavItem icon={<Wrench size={16} />} label="External Tools" active={activeCategory === 'tools'} onClick={() => setActiveCategory('tools')} />
          <NavItem icon={<CloudArrowDown size={16} />} label="Updates" active={activeCategory === 'updates'} onClick={() => setActiveCategory('updates')} />
        </div>

        {/* Settings Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 32px 48px 32px' }}>

          {activeCategory === 'appearance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '720px', width: '100%' }}>
              <SectionTitle icon={<Palette size={18} weight="duotone" />} title="Appearance" />

              <SettingCard>
                <SettingRow label="Accent Color Mode" description="Controls how the app's accent color is determined">
                  <SegmentedControl
                    options={[
                      { label: 'Dynamic', value: 'dynamic' },
                      { label: 'Custom', value: 'custom' },
                    ]}
                    value={themeMode}
                    onChange={(v) => setThemeMode(v as 'dynamic' | 'custom')}
                  />
                </SettingRow>

                {themeMode === 'dynamic' && (
                  <>
                    <Divider />
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                      The accent color is automatically extracted from the currently playing track's album art, creating a unique atmosphere for every song.
                    </div>
                  </>
                )}

                {themeMode === 'custom' && (
                  <>
                    <Divider />
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>Choose a fixed accent color for the entire app.</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      {presetColors.map(({ color, name }) => (
                        <div
                          key={color}
                          onClick={() => setCustomAccent(color)}
                          title={name}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            backgroundColor: color,
                            cursor: 'pointer',
                            outline: customAccent.toLowerCase() === color ? `2.5px solid ${color}` : '2.5px solid transparent',
                            outlineOffset: '2px',
                            boxShadow: customAccent.toLowerCase() === color ? `0 0 12px ${color}80` : 'none',
                            transition: 'all 0.2s var(--ease)',
                            transform: customAccent.toLowerCase() === color ? 'scale(1.05)' : 'scale(1)',
                            flexShrink: 0,
                          }}
                        />
                      ))}

                      {/* Custom color picker button */}
                      <div style={{ position: 'relative' }}>
                        <div 
                          title="Pick custom color"
                          onClick={() => setIsPickerOpen(!isPickerOpen)}
                          style={{
                            position: 'relative',
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            overflow: 'hidden',
                            outline: !presetColors.some(p => p.color === customAccent.toLowerCase()) ? `2.5px solid ${customAccent}` : '2.5px solid transparent',
                            outlineOffset: '2px',
                            background: 'conic-gradient(#f43f5e, #eab308, #10b981, #3b82f6, #8b5cf6, #f43f5e)',
                            boxShadow: !presetColors.some(p => p.color === customAccent.toLowerCase()) ? `0 0 12px ${customAccent}80` : 'none',
                            cursor: 'pointer',
                            transition: 'all 0.2s var(--ease)',
                            transform: !presetColors.some(p => p.color === customAccent.toLowerCase()) ? 'scale(1.05)' : 'scale(1)',
                            flexShrink: 0,
                        }} />

                        {isPickerOpen && (
                          <div style={{
                            position: 'absolute',
                            top: '40px',
                            left: '0',
                            backgroundColor: 'oklch(0.18 0 0)',
                            border: '1px solid var(--divider)',
                            borderRadius: '12px',
                            padding: '16px',
                            zIndex: 100,
                            width: '200px',
                            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.05)',
                            backdropFilter: 'blur(20px)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '14px'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>Custom Color</span>
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '-4px' }}>
                                <label style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Hue</label>
                                <label style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{hue}°</label>
                              </div>
                              <input 
                                type="range" 
                                className="custom-color-slider"
                                min="0" 
                                max="360" 
                                value={hue}
                                onChange={(e) => {
                                  const h = parseInt(e.target.value);
                                  setHue(h);
                                  setCustomAccent(hslToHex(h, sat, light));
                                }}
                                style={{ background: 'linear-gradient(to right, #f43f5e, #eab308, #10b981, #3b82f6, #8b5cf6, #f43f5e)' }}
                              />
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '-4px' }}>
                                <label style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Saturation</label>
                                <label style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{sat}%</label>
                              </div>
                              <input 
                                type="range" 
                                className="custom-color-slider"
                                min="0" 
                                max="100" 
                                value={sat}
                                onChange={(e) => {
                                  const s = parseInt(e.target.value);
                                  setSat(s);
                                  setCustomAccent(hslToHex(hue, s, light));
                                }}
                                style={{ background: `linear-gradient(to right, #555, ${hslToHex(hue, 100, light)})` }}
                              />
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '-4px' }}>
                                <label style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Lightness</label>
                                <label style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{light}%</label>
                              </div>
                              <input 
                                type="range" 
                                className="custom-color-slider"
                                min="0" 
                                max="100" 
                                value={light}
                                onChange={(e) => {
                                  const l = parseInt(e.target.value);
                                  setLight(l);
                                  setCustomAccent(hslToHex(hue, sat, l));
                                }}
                                style={{ background: `linear-gradient(to right, #000, ${hslToHex(hue, sat, 50)}, #fff)` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </SettingCard>
            </div>
          )}

          {activeCategory === 'audio' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '720px', width: '100%' }}>
              <SectionTitle icon={<Faders size={18} weight="duotone" />} title="Audio" />

              <SettingCard>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
                  Fine-tune your listening experience with the 10-band equalizer.
                </div>
                <EqPanel />
              </SettingCard>
            </div>
          )}

          {activeCategory === 'library' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '720px', width: '100%' }}>
              <SectionTitle icon={<MusicNotes size={18} weight="duotone" />} title="Library" />

              <SettingCard>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
                  Search iTunes to automatically fill in missing metadata, album art, and artist information for your local songs.
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    className="btn-primary"
                    onClick={() => handleFixMetadata(false)}
                    disabled={isFixing}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '8px',
                      padding: '0 18px', height: '34px', borderRadius: '8px',
                      fontSize: '13px', fontWeight: 600,
                      opacity: isFixing ? 0.6 : 1,
                    }}
                  >
                    <Lightning size={14} weight="fill" />
                    Fix Missing Only
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => handleFixMetadata(true)}
                    disabled={isFixing}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '8px',
                      padding: '0 18px', height: '34px', borderRadius: '8px',
                      fontSize: '13px', fontWeight: 600,
                      opacity: isFixing ? 0.6 : 1,
                    }}
                  >
                    <ArrowClockwise size={14} weight="bold" />
                    Force Update All
                  </button>
                </div>

                {(isFixing || fixResult) && (
                  <>
                    <Divider />
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      color: isFixing ? 'var(--text-secondary)' : (fixResult?.startsWith('Error') ? '#f87171' : '#34d399'),
                      lineHeight: 1.4,
                    }}>
                      {isFixing && <CircleNotch size={14} className="spinning-icon" />}
                      {!isFixing && !fixResult?.startsWith('Error') && <CheckCircle size={14} weight="fill" />}
                      {fixResult}
                    </div>
                  </>
                )}
              </SettingCard>
            </div>
          )}

          {activeCategory === 'tools' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '720px', width: '100%' }}>
              <SectionTitle icon={<Wrench size={18} weight="duotone" />} title="External Tools" />

              <SettingCard>
                <SettingRow
                  label="yt-dlp & FFmpeg"
                  description={
                    toolsInstalled === null ? 'Checking status...' :
                    toolsInstalled ? 'Installed and ready to use' : 'Required for downloading from YouTube'
                  }
                >
                  <button
                    className={toolsInstalled ? "btn-secondary" : "btn-primary"}
                    onClick={handleDownloadTools}
                    disabled={isDownloading || toolsInstalled === true || toolsInstalled === null}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '0 16px',
                      height: '32px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      opacity: (isDownloading || toolsInstalled === null) ? 0.6 : 1,
                      cursor: (isDownloading || toolsInstalled) ? 'default' : 'pointer',
                    }}
                  >
                    {isDownloading ? (
                      <><CircleNotch size={14} className="spinning-icon" /> Downloading...</>
                    ) : toolsInstalled ? (
                      <><CheckCircle size={14} weight="fill" /> Installed</>
                    ) : (
                      <><DownloadSimple size={14} weight="bold" /> Download</>
                    )}
                  </button>
                </SettingRow>

                {downloadError && (
                  <>
                    <Divider />
                    <div style={{ fontSize: '12px', color: '#f87171', lineHeight: 1.4 }}>{downloadError}</div>
                  </>
                )}
              </SettingCard>

              <div style={{ fontSize: '12px', color: 'var(--text-quaternary)', lineHeight: 1.5 }}>
                Stave uses yt-dlp and FFmpeg to download and process audio from YouTube. These tools are stored locally in the app's data directory.
              </div>
            </div>
          )}

          {activeCategory === 'updates' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '720px', width: '100%' }}>
              <SectionTitle icon={<CloudArrowDown size={18} weight="duotone" />} title="Updates" />

              <SettingCard>
                <SettingRow
                  label="In-App Updates"
                  description="Check GitHub for the latest version of Stave."
                >
                  <button
                    className="btn-primary"
                    onClick={handleCheckUpdate}
                    disabled={isCheckingUpdate}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '0 16px',
                      height: '32px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      opacity: isCheckingUpdate ? 0.6 : 1,
                      cursor: isCheckingUpdate ? 'default' : 'pointer',
                    }}
                  >
                    {isCheckingUpdate ? (
                      <><CircleNotch size={14} className="spinning-icon" /> Checking...</>
                    ) : (
                      <><CloudArrowDown size={14} weight="bold" /> Check for Updates</>
                    )}
                  </button>
                </SettingRow>
              </SettingCard>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
