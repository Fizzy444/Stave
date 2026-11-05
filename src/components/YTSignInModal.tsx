import { useEffect, useState } from 'react';
import { ArrowSquareOut, ArrowsClockwise, Browsers, CheckCircle, Globe, Key, SignOut, UserCircle, WarningCircle, X } from '@phosphor-icons/react';
import { useYTAuthStore } from '../store/ytauth';
import './YTSignInModal.css';

type AuthTab = 'signin' | 'browser' | 'manual' | 'account';

export function YTSignInModal() {
  const { account, isLoading, isModalOpen, error, closeModal, openInAppLogin, saveCustomAccount, syncBrowserCookies, signInBrowser, signOut } = useYTAuthStore();
  const [activeTab, setActiveTab] = useState<AuthTab>(account?.is_authenticated ? 'account' : 'signin');
  const [manualName, setManualName] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualCookie, setManualCookie] = useState('');
  const [browser, setBrowser] = useState('auto');
  const [clientId, setClientId] = useState('');

  // Reflect the connected account as soon as the sign-in window finishes, and show
  // the right starting tab when the modal is (re)opened.
  useEffect(() => {
    if (!isModalOpen) return;
    setActiveTab(account?.is_authenticated ? 'account' : 'signin');
  }, [isModalOpen, account?.is_authenticated]);

  if (!isModalOpen) return null;

  const displayName = account?.name === 'Loading profile' ? 'Loading profile…' : account?.name;
  const saveManual = () => {
    if (!manualName.trim() && !manualEmail.trim() && !manualCookie.trim()) return;
    saveCustomAccount(manualName.trim() || manualEmail.trim() || 'Music profile', manualEmail.trim() || undefined, manualCookie.trim() || undefined);
  };

  const tabs: { id: AuthTab; label: string; icon: typeof Browsers }[] = [
    { id: 'signin', label: 'Sign in', icon: Browsers },
    { id: 'browser', label: 'Browser session', icon: Globe },
    { id: 'manual', label: 'Manual', icon: Key },
    { id: 'account', label: 'Profile', icon: UserCircle },
  ];

  return (
    <div className="yt-auth-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !isLoading) closeModal(); }}>
      <section className="yt-auth-panel" aria-label="Music account">
        <header className="yt-auth-heading">
          <div className="yt-auth-identity">
            {account?.avatar_url ? <img src={account.avatar_url} alt="" /> : <span className="yt-auth-avatar">{account?.is_authenticated ? account.name.charAt(0).toUpperCase() : '♪'}</span>}
            <div>
              <span className="yt-auth-source">YouTube Music</span>
              <h2>{account?.is_authenticated ? displayName : 'Connect a profile'}</h2>
              {account?.is_authenticated && <p>{account.channel_title || account.email || 'Signed in'}</p>}
            </div>
          </div>
          <button className="yt-auth-close" onClick={closeModal} aria-label="Close"><X size={18} /></button>
        </header>

        <nav className="yt-auth-tabs" aria-label="Account settings">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`yt-auth-tab${activeTab === id ? ' is-active' : ''}`} onClick={() => setActiveTab(id)}>
              <Icon size={15} /><span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="yt-auth-content">
          {error && <div className="yt-auth-error"><WarningCircle size={17} /><span>{error}</span></div>}

          {activeTab === 'signin' && (
            <div className="yt-auth-signin">
              <p>Sign in to YouTube Music. Stave will use this profile for playback and show its saved playlists in your library.</p>
              {account?.is_authenticated && <div className="yt-auth-current"><CheckCircle size={17} /> Connected as <strong>{displayName}</strong></div>}
              <button className="yt-auth-primary" onClick={openInAppLogin} disabled={isLoading}>
                {isLoading ? <ArrowsClockwise className="spinning-icon" size={17} /> : <ArrowSquareOut size={17} />}
                {account?.is_authenticated ? 'Switch account' : 'Sign in with Google'}
              </button>
              <span className="yt-auth-note">A Google sign-in window will open. Stave connects automatically and closes it as soon as you finish signing in.</span>
            </div>
          )}

          {activeTab === 'browser' && (
            <div className="yt-auth-form">
              <h3>Connect a browser session</h3>
              <p>Use a YouTube Music session already signed in on this computer.</p>
              <label htmlFor="yt-browser">Browser</label>
              <select id="yt-browser" className="yt-auth-input" value={browser} onChange={(e) => setBrowser(e.target.value)}>
                <option value="auto">Auto-detect browser</option>
                <option value="zen">Zen Browser</option>
                <option value="firefox">Firefox</option>
                <option value="edge">Microsoft Edge</option>
                <option value="chrome">Google Chrome</option>
                <option value="brave">Brave</option>
                <option value="floorp">Floorp</option>
                <option value="opera">Opera</option>
                <option value="vivaldi">Vivaldi</option>
              </select>
              <button className="yt-auth-secondary" disabled={isLoading} onClick={() => syncBrowserCookies(browser)}>
                {isLoading ? <ArrowsClockwise className="spinning-icon" size={16} /> : <Globe size={16} />} Connect {browser === 'auto' ? 'session' : browser}
              </button>
              <label htmlFor="yt-oauth-client">Google OAuth client ID <span>optional</span></label>
              <input id="yt-oauth-client" className="yt-auth-input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="client.apps.googleusercontent.com" />
              <button className="yt-auth-link" onClick={() => signInBrowser(clientId.trim() || undefined)} disabled={isLoading}>Continue with Google sign-in</button>
            </div>
          )}

          {activeTab === 'manual' && (
            <div className="yt-auth-form">
              <h3>Manual profile</h3>
              <p>For users who already have a YouTube Music session cookie.</p>
              <label htmlFor="yt-name">Profile name</label>
              <input id="yt-name" className="yt-auth-input" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Name" />
              <label htmlFor="yt-email">Email <span>optional</span></label>
              <input id="yt-email" type="email" className="yt-auth-input" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="name@example.com" />
              <label htmlFor="yt-cookie">Session cookie</label>
              <textarea id="yt-cookie" className="yt-auth-input yt-auth-cookie" value={manualCookie} onChange={(e) => setManualCookie(e.target.value)} placeholder="Cookie header from music.youtube.com" />
              <button className="yt-auth-primary" disabled={isLoading} onClick={saveManual}>Save profile</button>
            </div>
          )}

          {activeTab === 'account' && (
            <div className="yt-auth-account">
              {account?.is_authenticated ? <>
                <div className="yt-auth-profile">
                  {account.avatar_url ? <img src={account.avatar_url} alt="" /> : <span className="yt-auth-avatar">{account.name.charAt(0).toUpperCase()}</span>}
                  <div><h3>{displayName}</h3><p>{account.channel_title || account.email || 'YouTube Music'}</p></div>
                </div>
                <div className="yt-auth-account-footer"><span>Connected through {account.auth_type.replace(/_/g, ' ')}</span><button className="yt-auth-signout" onClick={signOut}><SignOut size={16} /> Sign out</button></div>
              </> : <div className="yt-auth-empty"><UserCircle size={34} /><p>No profile connected.</p><button className="yt-auth-link" onClick={() => setActiveTab('signin')}>Sign in to YouTube Music</button></div>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
