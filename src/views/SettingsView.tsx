import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { CircleNotch, DownloadSimple, CheckCircle, Palette, Faders, Wrench, MusicNotes, ArrowClockwise, Lightning, CloudArrowDown, Keyboard } from '@phosphor-icons/react';
import { EqPanel } from '../components/EqPanel';
import { useThemeStore } from '../store/theme';
import { useYTAuthStore } from '../store/ytauth';
import { useLibraryStore } from '../store/library';
import { YoutubeLogo, Globe, SignOut } from '@phosphor-icons/react';

// --- Reusable Setting Components ---

const SettingCard = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{
    backgroundColor: 'var(--surface-panel)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    padding: '16px 20px',
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
    minHeight: '36px',
  }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-system)' }}>{label}</div>
      {description && <div style={{ fontSize: '11.5px', color: 'var(--text-tertiary)', marginTop: '2px', fontFamily: 'var(--font-system)', lineHeight: 1.4 }}>{description}</div>}
    </div>
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
      {children}
    </div>
  </div>
);

const Divider = () => <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '10px 0' }} />;

const SectionTitle = ({ icon, title }: { icon: React.ReactNode; title: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
    <div style={{ color: 'var(--accent)', display: 'flex' }}>{icon}</div>
    <h3 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-system)', margin: 0 }}>
      {title}
    </h3>
  </div>
);

const SegmentedControl = ({ options, value, onChange }: { options: { label: string; value: string }[]; value: string; onChange: (v: string) => void }) => (
  <div style={{
    display: 'inline-flex',
    backgroundColor: 'var(--surface-element)',
    borderRadius: 'var(--radius-sm)',
    padding: '3px',
    gap: '2px',
    border: '1px solid var(--border-contrast)',
  }}>
    {options.map(opt => (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        style={{
          padding: '4px 12px',
          borderRadius: 'var(--radius-sm)',
          border: 'none',
          fontSize: '11px',
          fontFamily: 'var(--font-system)',
          fontWeight: value === opt.value ? 600 : 500,
          cursor: 'pointer',
          letterSpacing: '0.01em',
          transition: 'background 0.15s var(--ease), color 0.15s var(--ease)',
          backgroundColor: value === opt.value ? 'var(--accent)' : 'transparent',
          color: value === opt.value ? 'var(--accent-contrast, #000)' : 'var(--text-tertiary)',
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
      gap: '8px',
      height: '32px',
      padding: '0 12px',
      borderRadius: 'var(--radius-sm)',
      background: active ? 'var(--surface-selected)' : 'transparent',
      color: active ? '#ffffff' : 'var(--text-secondary)',
      border: 'none',
      cursor: 'pointer',
      textAlign: 'left',
      fontSize: '12px',
      fontFamily: 'var(--font-system)',
      fontWeight: active ? 600 : 500,
      transition: 'background 0.15s var(--ease), color 0.15s var(--ease)',
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
  const [activeCategory, setActiveCategory] = useState<'account' | 'appearance' | 'audio' | 'tools' | 'library' | 'updates' | 'shortcuts'>('appearance');
  const { account, openModal, signOut } = useYTAuthStore();
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
    setFixResult("Updating metadata. This can take a little while for large libraries.");
    try {
      const updatedCount = await invoke<number>('auto_fix_metadata', { forceAll });
      await useLibraryStore.getState().loadTracks();
      setFixResult(`Updated ${updatedCount} songs.`);
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
          title: 'Update available',
          kind: 'info',
        });
        if (yes) {
          await update.downloadAndInstall();
          await message('Update installed. Restart Stave to apply changes.', { title: 'Update installed', kind: 'info' });
        }
      } else {
        await message('You are on the latest version.', { title: 'No updates', kind: 'info' });
      }
    } catch (e: any) {
      console.error(e);
      await message(`Couldn't check for updates: ${e}`, { title: 'Update check failed', kind: 'error' });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const presetColors = [
    { color: '#ffffff', name: 'White (Monochrome)' },
    { color: '#e2e8f0', name: 'Silver' },
    { color: '#94a3b8', name: 'Slate' },
    { color: '#ff3b30', name: 'Apple Red' },
    { color: '#007aff', name: 'Apple Blue' },
    { color: '#34c759', name: 'Apple Green' },
    { color: '#af52de', name: 'Apple Purple' },
    { color: '#ff9500', name: 'Apple Orange' },
  ];

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column' }}>
      <header className="page-header settings-page-header">
        <div className="page-header-text">
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Appearance, playback, and library preferences.</p>
        </div>
      </header>

      <div className="view-content settings-body">

        {/* Settings Nav */}
        <div style={{
          width: '200px',
          padding: '4px 0 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          flexShrink: 0,
        }}>
          <NavItem icon={<YoutubeLogo size={14} />} label="YouTube Music" active={activeCategory === 'account'} onClick={() => setActiveCategory('account')} />
          <NavItem icon={<Palette size={14} />} label="Appearance" active={activeCategory === 'appearance'} onClick={() => setActiveCategory('appearance')} />
          <NavItem icon={<Faders size={14} />} label="Equalizer" active={activeCategory === 'audio'} onClick={() => setActiveCategory('audio')} />
          <NavItem icon={<MusicNotes size={14} />} label="Metadata" active={activeCategory === 'library'} onClick={() => setActiveCategory('library')} />
          <NavItem icon={<Keyboard size={14} />} label="Keyboard shortcuts" active={activeCategory === 'shortcuts'} onClick={() => setActiveCategory('shortcuts')} />
          <NavItem icon={<Wrench size={14} />} label="Audio tools" active={activeCategory === 'tools'} onClick={() => setActiveCategory('tools')} />
          <NavItem icon={<CloudArrowDown size={14} />} label="Updates" active={activeCategory === 'updates'} onClick={() => setActiveCategory('updates')} />
        </div>

        {/* Settings Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 48px 32px' }}>

          {activeCategory === 'account' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '720px', width: '100%' }}>
              <SectionTitle icon={<YoutubeLogo size={15} weight="regular" />} title="YouTube Music account" />

              <SettingCard>
                {account && account.is_authenticated ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      {account.avatar_url ? (
                        <img src={account.avatar_url} alt="" style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1px solid var(--border-subtle)', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'var(--surface-element)', border: '1px solid var(--border-subtle)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-system)' }}>
                          {account.name.charAt(0)}
                        </div>
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', fontFamily: 'var(--font-system)' }}>{account.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-system)' }}>{account.email || account.channel_title}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px', fontWeight: 500, fontFamily: 'var(--font-system)' }}>Connected</div>
                      </div>
                    </div>

                    <Divider />

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn-secondary" onClick={openModal} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '30px', padding: '0 14px', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-system)', fontSize: '12px' }}>
                        <Globe size={14} />
                        <span>Switch account</span>
                      </button>
                      <button className="btn-secondary" onClick={signOut} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '30px', padding: '0 14px', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-system)', fontSize: '12px', color: '#ff453a' }}>
                        <SignOut size={14} />
                        <span>Sign out</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-system)' }}>
                      Not connected
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, fontFamily: 'var(--font-system)' }}>
                      Sign in with YouTube Music to see your playlists and recommendations.
                    </div>
                    <button
                      className="btn-primary"
                      onClick={openModal}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        width: 'fit-content',
                        fontWeight: 600,
                        fontFamily: 'var(--font-system)',
                        fontSize: '12px',
                        padding: '0 16px',
                        height: '30px',
                        borderRadius: 'var(--radius-sm)',
                        marginTop: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      <Globe size={14} weight="regular" />
                      <span>Sign in</span>
                    </button>
                  </div>
                )}
              </SettingCard>
            </div>
          )}

          {activeCategory === 'appearance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '720px', width: '100%' }}>
              <SectionTitle icon={<Palette size={15} weight="bold" />} title="Theme" />

              <SettingCard>
                <SettingRow label="Theme" description="Choose how Stave looks.">
                  <SegmentedControl
                    options={[
                      { label: 'Monochrome', value: 'monochrome' },
                      { label: 'Album colors', value: 'dynamic' },
                      { label: 'Custom color', value: 'custom' },
                    ]}
                    value={themeMode}
                    onChange={(v) => setThemeMode(v as any)}
                  />
                </SettingRow>

                {themeMode === 'monochrome' && (
                  <>
                    <Divider />
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-system)', lineHeight: 1.5 }}>
                      A clean, neutral dark theme with subtle surfaces and crisp white controls.
                    </div>
                  </>
                )}

                {themeMode === 'dynamic' && (
                  <>
                    <Divider />
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-system)', lineHeight: 1.5 }}>
                      Colors follow the artwork of the song that's playing.
                    </div>
                  </>
                )}

                {themeMode === 'custom' && (
                  <>
                    <Divider />
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-system)', marginBottom: '10px' }}>
                      Accent color
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {presetColors.map(({ color, name }) => (
                        <div
                          key={color}
                          onClick={() => setCustomAccent(color)}
                          title={name}
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            backgroundColor: color,
                            cursor: 'pointer',
                            outline: customAccent.toLowerCase() === color ? '2px solid #ffffff' : '1px solid var(--border-contrast)',
                            outlineOffset: '2px',
                            flexShrink: 0,
                          }}
                        />
                      ))}

                      {/* Custom color picker button */}
                      <div style={{ position: 'relative' }}>
                        <div 
                          title="Pick custom hue"
                          onClick={() => setIsPickerOpen(!isPickerOpen)}
                          style={{
                            position: 'relative',
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            overflow: 'hidden',
                            outline: !presetColors.some(p => p.color === customAccent.toLowerCase()) ? '2px solid #ffffff' : '1px solid var(--border-contrast)',
                            outlineOffset: '2px',
                            background: 'conic-gradient(#f43f5e, #eab308, #10b981, #3b82f6, #8b5cf6, #f43f5e)',
                            cursor: 'pointer',
                            flexShrink: 0,
                        }} />

                        {isPickerOpen && (
                          <div style={{
                            position: 'absolute',
                            top: '36px',
                            left: '0',
                            backgroundColor: 'var(--surface-overlay)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-md)',
                            padding: '14px',
                            zIndex: 100,
                            width: '200px',
                            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.8)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            backdropFilter: 'blur(20px)'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-system)', color: 'var(--text-primary)' }}>Custom color</span>
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <label style={{ fontSize: '10px', fontFamily: 'var(--font-system)', color: 'var(--text-tertiary)' }}>Hue</label>
                                <label style={{ fontSize: '10px', fontFamily: 'var(--font-system)', color: 'var(--text-tertiary)' }}>{hue}°</label>
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
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <label style={{ fontSize: '10px', fontFamily: 'var(--font-system)', color: 'var(--text-tertiary)' }}>Saturation</label>
                                <label style={{ fontSize: '10px', fontFamily: 'var(--font-system)', color: 'var(--text-tertiary)' }}>{sat}%</label>
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
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <label style={{ fontSize: '10px', fontFamily: 'var(--font-system)', color: 'var(--text-tertiary)' }}>Lightness</label>
                                <label style={{ fontSize: '10px', fontFamily: 'var(--font-system)', color: 'var(--text-tertiary)' }}>{light}%</label>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '720px', width: '100%' }}>
              <SectionTitle icon={<Faders size={15} weight="bold" />} title="Equalizer" />

              <SettingCard>
                <div style={{ fontSize: '11px', color: 'var(--text-quaternary)', marginBottom: '14px', fontFamily: 'var(--font-system)' }}>
                  Fine-tune the sound with a 10-band equalizer.
                </div>
                <EqPanel />
              </SettingCard>
            </div>
          )}

          {activeCategory === 'library' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '720px', width: '100%' }}>
              <SectionTitle icon={<MusicNotes size={15} weight="bold" />} title="Metadata" />

              <SettingCard>
                <div style={{ fontSize: '11px', color: 'var(--text-quaternary)', marginBottom: '16px', fontFamily: 'var(--font-system)', lineHeight: 1.5 }}>
                  Look up missing titles, artists, and cover art from iTunes.
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className="btn-primary"
                    onClick={() => handleFixMetadata(false)}
                    disabled={isFixing}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '0 16px', height: '30px', borderRadius: 'var(--radius-sm)',
                      fontSize: '12px', fontFamily: 'var(--font-system)', fontWeight: 600,
                      opacity: isFixing ? 0.6 : 1,
                    }}
                  >
                    <Lightning size={14} weight="fill" />
                    <span>Fill in missing info</span>
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => handleFixMetadata(true)}
                    disabled={isFixing}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '0 16px', height: '30px', borderRadius: 'var(--radius-sm)',
                      fontSize: '12px', fontFamily: 'var(--font-system)', fontWeight: 500,
                      opacity: isFixing ? 0.6 : 1,
                    }}
                  >
                    <ArrowClockwise size={14} weight="bold" />
                    <span>Refresh all metadata</span>
                  </button>
                </div>

                {(isFixing || fixResult) && (
                  <>
                    <Divider />
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '12px',
                      fontFamily: 'var(--font-system)',
                      color: isFixing ? 'var(--text-secondary)' : (fixResult?.startsWith('Error') ? '#f87171' : 'var(--text-primary)'),
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

          {activeCategory === 'shortcuts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '720px', width: '100%' }}>
              <SectionTitle icon={<Keyboard size={15} weight="bold" />} title="Keyboard shortcuts" />

              <SettingCard>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                  <SettingRow label="Play / Pause">
                    <kbd style={{ background: 'var(--surface-element)', border: '1px solid var(--border-subtle)', padding: '3px 10px', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontFamily: 'var(--font-system)', color: 'var(--text-primary)' }}>Space</kbd>
                  </SettingRow>
                  <Divider />
                  <SettingRow label="Next song">
                    <kbd style={{ background: 'var(--surface-element)', border: '1px solid var(--border-subtle)', padding: '3px 10px', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontFamily: 'var(--font-system)', color: 'var(--text-primary)' }}>Right Arrow</kbd>
                  </SettingRow>
                  <Divider />
                  <SettingRow label="Previous song">
                    <kbd style={{ background: 'var(--surface-element)', border: '1px solid var(--border-subtle)', padding: '3px 10px', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontFamily: 'var(--font-system)', color: 'var(--text-primary)' }}>Left Arrow</kbd>
                  </SettingRow>
                  <Divider />
                  <SettingRow label="Volume up">
                    <kbd style={{ background: 'var(--surface-element)', border: '1px solid var(--border-subtle)', padding: '3px 10px', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontFamily: 'var(--font-system)', color: 'var(--text-primary)' }}>Up Arrow</kbd>
                  </SettingRow>
                  <Divider />
                  <SettingRow label="Volume down">
                    <kbd style={{ background: 'var(--surface-element)', border: '1px solid var(--border-subtle)', padding: '3px 10px', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontFamily: 'var(--font-system)', color: 'var(--text-primary)' }}>Down Arrow</kbd>
                  </SettingRow>
                  <Divider />
                  <SettingRow label="Fullscreen player">
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                       <kbd style={{ background: 'var(--surface-element)', border: '1px solid var(--border-subtle)', padding: '3px 10px', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontFamily: 'var(--font-system)', color: 'var(--text-primary)' }}>F</kbd>
                       <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-system)' }}>or</span>
                       <kbd style={{ background: 'var(--surface-element)', border: '1px solid var(--border-subtle)', padding: '3px 10px', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontFamily: 'var(--font-system)', color: 'var(--text-primary)' }}>F11</kbd>
                    </div>
                  </SettingRow>
                  <Divider />
                  <SettingRow label="Close fullscreen player">
                    <kbd style={{ background: 'var(--surface-element)', border: '1px solid var(--border-subtle)', padding: '3px 10px', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontFamily: 'var(--font-system)', color: 'var(--text-primary)' }}>Esc</kbd>
                  </SettingRow>
                </div>
              </SettingCard>
            </div>
          )}

          {activeCategory === 'tools' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '720px', width: '100%' }}>
              <SectionTitle icon={<Wrench size={15} weight="bold" />} title="Audio tools" />

              <SettingCard>
                <SettingRow
                  label="yt-dlp & FFmpeg"
                  description={
                    toolsInstalled === null ? 'Checking…' :
                    toolsInstalled ? 'Downloaded and ready' : 'Needed to download and convert audio'
                  }
                >
                  <button
                    className={toolsInstalled ? "btn-secondary" : "btn-primary"}
                    onClick={handleDownloadTools}
                    disabled={isDownloading || toolsInstalled === true || toolsInstalled === null}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '0 16px',
                      height: '30px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-system)',
                      fontWeight: 600,
                      opacity: (isDownloading || toolsInstalled === null) ? 0.6 : 1,
                      cursor: (isDownloading || toolsInstalled) ? 'default' : 'pointer',
                    }}
                  >
                    {isDownloading ? (
                      <><CircleNotch size={14} className="spinning-icon" /> Downloading…</>
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
                    <div style={{ fontSize: '12px', color: '#f87171', fontFamily: 'var(--font-system)', lineHeight: 1.4 }}>{downloadError}</div>
                  </>
                )}
              </SettingCard>

              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-system)', lineHeight: 1.5 }}>
                Tools are saved with Stave and won't change anything else on your system.
              </div>
            </div>
          )}

          {activeCategory === 'updates' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '720px', width: '100%' }}>
              <SectionTitle icon={<CloudArrowDown size={15} weight="bold" />} title="Software updates" />

              <SettingCard>
                <SettingRow
                  label="Software updates"
                  description="Check for a newer version of Stave."
                >
                  <button
                    className="btn-primary"
                    onClick={handleCheckUpdate}
                    disabled={isCheckingUpdate}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '0 16px',
                      height: '30px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-system)',
                      fontWeight: 600,
                      opacity: isCheckingUpdate ? 0.6 : 1,
                      cursor: isCheckingUpdate ? 'default' : 'pointer',
                    }}
                  >
                    {isCheckingUpdate ? (
                      <><CircleNotch size={14} className="spinning-icon" /> Checking…</>
                    ) : (
                      <><CloudArrowDown size={14} weight="bold" /> Check for updates</>
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
