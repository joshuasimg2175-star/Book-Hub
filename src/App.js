import React, { useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import MyShelf from './pages/Home';
import Home from './pages/HomeTimeline';
import Settings from './pages/Settings';
import Friends from './pages/Friends';
import Login from './pages/Login';
import Signup from './pages/Signup';
import { getCurrentUser, refreshCurrentUserFromServer, signOutUser, updateCurrentUserProfile } from './utils/authStorage';
import { getBooks } from './utils/bookStorage';
import './App.css';
import './themes.css';
import { ReactComponent as Logo } from './assets/logo.svg';

const EMPTY_ACCOUNT_STATS = {
  totalBooks: 0,
  finished: 0,
  currentlyReading: 0,
  didNotFinish: 0,
  wishlist: 0,
  completionRate: 0
};

const normalizeBookStatus = (status) => {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'read' || value === 'finished') return 'finished';
  if (value === 'currently reading' || value === 'currently-reading' || value === 'reading') return 'currently reading';
  if (value === 'unread' || value === 'did not finish' || value === 'did-not-finish' || value === 'dnf') return 'did not finish';
  if (value === 'wishlist' || value === 'wish list' || value === 'wish') return 'wishlist';
  return value;
};

const buildAccountStats = (books) => {
  const list = Array.isArray(books) ? books : [];
  const snapshot = list.reduce(
    (acc, book) => {
      const status = normalizeBookStatus(book?.status);
      if (status === 'finished') acc.finished += 1;
      if (status === 'currently reading') acc.currentlyReading += 1;
      if (status === 'did not finish') acc.didNotFinish += 1;
      if (status === 'wishlist') acc.wishlist += 1;
      return acc;
    },
    { ...EMPTY_ACCOUNT_STATS, totalBooks: list.length }
  );
  const completionBase = Math.max(0, snapshot.totalBooks - snapshot.wishlist);
  snapshot.completionRate = completionBase > 0 ? Math.min(100, Math.round((snapshot.finished / completionBase) * 100)) : 0;
  return snapshot;
};

const formatMemberSince = (createdAt) => {
  if (!createdAt) return 'Unknown';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

const buildInitials = (value) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'BH';
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() || '').join('');
};

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSettingsDrawerOpen, setIsSettingsDrawerOpen] = useState(false);
  const [isAccountDrawerOpen, setIsAccountDrawerOpen] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountUsername, setAccountUsername] = useState('');
  const [accountNotice, setAccountNotice] = useState(null);
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => getCurrentUser());
  const [accountStats, setAccountStats] = useState(() => buildAccountStats(getBooks()));
  const settingsDrawerRef = useRef(null);
  const accountDrawerRef = useRef(null);
  const activeMobileTab = location.pathname.startsWith('/friends')
    ? 'friends'
    : location.pathname.startsWith('/shelf')
      ? 'shelf'
      : 'home';
  const firstName = String(currentUser?.name || '').split(' ').filter(Boolean)[0] || 'Account';

  useEffect(() => {
    setIsSettingsDrawerOpen(false);
    setIsAccountDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!currentUser) {
      setIsAccountDrawerOpen(false);
      setAccountName('');
      setAccountUsername('');
      return;
    }

    setAccountName(String(currentUser.name || ''));
    setAccountUsername(String(currentUser.username || ''));
  }, [currentUser, currentUser?.id, currentUser?.name, currentUser?.username]);

  useEffect(() => {
    if (!accountNotice) return undefined;
    const timer = window.setTimeout(() => setAccountNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [accountNotice]);

  useEffect(() => {
    const syncAuthState = () => {
      setCurrentUser(getCurrentUser());
    };

    window.addEventListener('authUpdated', syncAuthState);
    window.addEventListener('storage', syncAuthState);

    return () => {
      window.removeEventListener('authUpdated', syncAuthState);
      window.removeEventListener('storage', syncAuthState);
    };
  }, []);

  useEffect(() => {
    void refreshCurrentUserFromServer().then((user) => {
      setCurrentUser(user || getCurrentUser());
    });
  }, []);

  useEffect(() => {
    const refreshStats = () => {
      setAccountStats(buildAccountStats(getBooks()));
    };
    const handleStorage = (event) => {
      if (!event || event.key === 'bookHubBooks' || event.key === null) {
        refreshStats();
      }
    };

    refreshStats();
    window.addEventListener('booksUpdated', refreshStats);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('booksUpdated', refreshStats);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const handleAuthSuccess = (user) => {
    setCurrentUser(user || getCurrentUser());
  };

  const handleSignOut = async () => {
    await signOutUser();
    setCurrentUser(null);
    setIsSettingsDrawerOpen(false);
    setIsAccountDrawerOpen(false);
    navigate('/login');
  };

  const openProfileEditor = () => {
    if (!currentUser) {
      navigate('/login');
      return;
    }

    setAccountNotice(null);
    setIsSettingsDrawerOpen(false);
    setIsAccountDrawerOpen(true);
  };

  const openFromAccountDrawer = (path) => {
    setIsAccountDrawerOpen(false);
    navigate(path);
  };

  const handleAccountSave = async (event) => {
    event.preventDefault();
    if (!currentUser || isSavingAccount) return;

    const nextName = String(accountName || '').trim();
    const nextUsername = String(accountUsername || '').trim().toLowerCase().replace(/^@+/, '');

    if (nextName.length < 2) {
      setAccountNotice({ type: 'error', text: 'Display name must be at least 2 characters.' });
      return;
    }

    if (!/^[a-z0-9]{3,24}$/.test(nextUsername)) {
      setAccountNotice({ type: 'error', text: 'Username must be 3-24 letters or numbers.' });
      return;
    }

    const sameName = nextName === String(currentUser.name || '').trim();
    const sameUsername = nextUsername === String(currentUser.username || '').trim().toLowerCase();
    if (sameName && sameUsername) {
      setAccountNotice({ type: 'success', text: 'Your profile is already up to date.' });
      return;
    }

    setIsSavingAccount(true);
    try {
      const updatedUser = await updateCurrentUserProfile({ name: nextName, username: nextUsername });
      const nextUserState = updatedUser || getCurrentUser();
      setCurrentUser(nextUserState);
      setAccountName(String(nextUserState?.name || nextName));
      setAccountUsername(String(nextUserState?.username || nextUsername));
      setAccountNotice({ type: 'success', text: 'Profile updated.' });
    } catch (error) {
      setAccountNotice({ type: 'error', text: error?.message || 'Could not update profile right now.' });
    } finally {
      setIsSavingAccount(false);
    }
  };

  return (
    <div className="container app-shell app-shell-refresh mt-4 mt-md-5">
      <nav className="navbar top-navbar mb-4 glass-container">
        <div className="container-fluid">
            <Link className="navbar-brand d-flex align-items-center" to="/">
              <Logo className="app-logo" aria-hidden="true" />
              <span className="ms-2">BookHub</span>
            </Link>

          <div className="mobile-top-actions d-flex d-md-none align-items-center ms-auto">
            {currentUser ? (
              <button
                type="button"
                className="mobile-top-user mobile-user-button"
                title={currentUser.username ? `@${currentUser.username}` : (currentUser.email || currentUser.name)}
                onClick={openProfileEditor}
              >
                {firstName}
              </button>
            ) : (
              <NavLink className={({ isActive }) => `mobile-top-link ${isActive ? 'active' : ''}`} to="/login">Sign In</NavLink>
            )}
            <NavLink className={({ isActive }) => `mobile-top-link ${isActive ? 'active' : ''}`} to="/settings">Settings</NavLink>
          </div>

          <div className="desktop-nav d-none d-md-flex align-items-center ms-auto">
            <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/shelf">My Shelf</NavLink>
            <NavLink end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/">Home</NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/friends">Friends</NavLink>
            {currentUser ? (
              <button
                type="button"
                className="desktop-user-pill desktop-user-button"
                title={currentUser.username ? `@${currentUser.username}` : (currentUser.email || currentUser.name)}
                onClick={openProfileEditor}
              >
                {firstName}
              </button>
            ) : (
              <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/login">Sign In</NavLink>
            )}

            <div className="desktop-settings-menu">
              <button
                type="button"
                className="menu-toggle-btn"
                aria-expanded={isSettingsDrawerOpen}
                aria-label="Open settings menu"
                onClick={() => setIsSettingsDrawerOpen(true)}
              >
                <span />
                <span />
                <span />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/shelf" element={<MyShelf />} />
        <Route path="/friends" element={<Friends />} />
        <Route path="/login" element={<Login currentUser={currentUser} onAuthSuccess={handleAuthSuccess} />} />
        <Route path="/signup" element={<Signup currentUser={currentUser} onAuthSuccess={handleAuthSuccess} />} />
        <Route path="/settings" element={<Settings currentUser={currentUser} onSignOut={handleSignOut} />} />
      </Routes>

      <nav className="mobile-bottom-nav glass-container d-md-none" aria-label="Mobile navigation">
        <div className={`mobile-slider mobile-slider-3 ${activeMobileTab}-active`}>
          <span className="slider-pill" />
          <NavLink to="/shelf" className={({ isActive }) => `mobile-nav-link ${isActive ? 'active' : ''}`}>
            My Shelf
          </NavLink>
          <NavLink end to="/" className={({ isActive }) => `mobile-nav-link ${isActive ? 'active' : ''}`}>
            Home
          </NavLink>
          <NavLink to="/friends" className={({ isActive }) => `mobile-nav-link ${isActive ? 'active' : ''}`}>
            Friends
          </NavLink>
        </div>
      </nav>

      <div className={`settings-drawer-backdrop d-none d-md-block ${isSettingsDrawerOpen ? 'open' : ''}`} onClick={() => setIsSettingsDrawerOpen(false)} />
      <aside
        className={`settings-drawer d-none d-md-block ${isSettingsDrawerOpen ? 'open' : ''}`}
        ref={settingsDrawerRef}
        aria-hidden={!isSettingsDrawerOpen}
      >
        <div className="settings-drawer-header">
          <h5 className="mb-0">Settings</h5>
          <button type="button" className="btn-close" aria-label="Close settings" onClick={() => setIsSettingsDrawerOpen(false)} />
        </div>
        <div className="settings-drawer-content">
          <Settings isInOffcanvas currentUser={currentUser} onSignOut={handleSignOut} />
        </div>
      </aside>

      <div className={`account-drawer-backdrop ${isAccountDrawerOpen ? 'open' : ''}`} onClick={() => setIsAccountDrawerOpen(false)} />
      <aside
        className={`account-drawer ${isAccountDrawerOpen ? 'open' : ''}`}
        ref={accountDrawerRef}
        aria-hidden={!isAccountDrawerOpen}
      >
        <div className="account-drawer-header">
          <h5 className="mb-0">Account</h5>
          <button type="button" className="btn-close" aria-label="Close account panel" onClick={() => setIsAccountDrawerOpen(false)} />
        </div>
        <div className="account-drawer-content">
          {accountNotice && (
            <div className={`settings-notice ${accountNotice.type === 'error' ? 'error' : 'success'}`} role="status">
              {accountNotice.text}
            </div>
          )}
          {currentUser ? (
            <>
              <section className="account-summary-card">
                <div className="account-summary-avatar" aria-hidden="true">
                  {buildInitials(currentUser.name || currentUser.username || currentUser.email)}
                </div>
                <div className="account-summary-body">
                  <h6 className="mb-1">{currentUser.name || 'BookHub Reader'}</h6>
                  <p className="account-summary-handle mb-1">
                    @{String(currentUser.username || 'username').replace(/^@+/, '')}
                  </p>
                  <p className="settings-account-email mb-0">{currentUser.email}</p>
                </div>
                <span className="account-member-chip">Member since {formatMemberSince(currentUser.createdAt)}</span>
              </section>

              <section className="account-drawer-section">
                <div className="account-section-head">
                  <h6 className="mb-0">Profile</h6>
                  <small>Update your display name and username.</small>
                </div>
                <form className="settings-account-form" onSubmit={handleAccountSave}>
                  <label htmlFor="account-display-name" className="form-label mb-1">
                    Display Name
                  </label>
                  <input
                    id="account-display-name"
                    type="text"
                    className="form-control"
                    value={accountName}
                    onChange={(event) => setAccountName(event.target.value)}
                    maxLength={80}
                    autoComplete="name"
                  />
                  <label htmlFor="account-username" className="form-label mb-1">
                    Username
                  </label>
                  <input
                    id="account-username"
                    type="text"
                    className="form-control"
                    value={accountUsername}
                    onChange={(event) => setAccountUsername(event.target.value)}
                    maxLength={24}
                    autoComplete="username"
                    spellCheck="false"
                    placeholder="username"
                  />
                  <button
                    type="submit"
                    className="btn btn-primary w-100"
                    disabled={isSavingAccount}
                  >
                    {isSavingAccount ? 'Saving...' : 'Save Profile'}
                  </button>
                </form>
              </section>

              <section className="account-drawer-section">
                <div className="account-section-head">
                  <h6 className="mb-0">Reading Snapshot</h6>
                  <small>Updates automatically from your shelf.</small>
                </div>
                <div className="account-snapshot-grid">
                  <div className="account-snapshot-tile">
                    <span className="account-snapshot-value">{accountStats.totalBooks}</span>
                    <span className="account-snapshot-label">Total</span>
                  </div>
                  <div className="account-snapshot-tile">
                    <span className="account-snapshot-value">{accountStats.finished}</span>
                    <span className="account-snapshot-label">Finished</span>
                  </div>
                  <div className="account-snapshot-tile">
                    <span className="account-snapshot-value">{accountStats.currentlyReading}</span>
                    <span className="account-snapshot-label">Reading</span>
                  </div>
                  <div className="account-snapshot-tile">
                    <span className="account-snapshot-value">{accountStats.didNotFinish}</span>
                    <span className="account-snapshot-label">Didn't Finish</span>
                  </div>
                  <div className="account-snapshot-tile">
                    <span className="account-snapshot-value">{accountStats.wishlist}</span>
                    <span className="account-snapshot-label">Wishlist</span>
                  </div>
                  <div className="account-snapshot-tile">
                    <span className="account-snapshot-value">{accountStats.completionRate}%</span>
                    <span className="account-snapshot-label">Completion</span>
                  </div>
                </div>
              </section>

              <section className="account-drawer-section">
                <div className="account-section-head">
                  <h6 className="mb-0">Quick Actions</h6>
                </div>
                <div className="account-actions-grid">
                  <button type="button" className="btn btn-outline-primary" onClick={() => openFromAccountDrawer('/shelf')}>My Shelf</button>
                  <button type="button" className="btn btn-outline-primary" onClick={() => openFromAccountDrawer('/')}>Home</button>
                  <button type="button" className="btn btn-outline-primary" onClick={() => openFromAccountDrawer('/friends')}>Friends</button>
                  <button type="button" className="btn btn-outline-secondary" onClick={() => openFromAccountDrawer('/settings')}>Settings</button>
                </div>
              </section>
            </>
          ) : (
            <>
              <p className="settings-account-email mb-2">Sign in to access your profile, reading stats, and friend features.</p>
              <button type="button" className="btn btn-primary w-100" onClick={() => openFromAccountDrawer('/login')}>
                Sign In
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-outline-secondary w-100 mt-3"
            onClick={() => {
              openFromAccountDrawer('/settings');
            }}
          >
            Open Full Settings
          </button>
          {currentUser && (
            <button type="button" className="btn btn-outline-danger w-100 mt-2" onClick={() => void handleSignOut()}>
              Sign Out
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

function AppContent() {
  return (
    <Router>
      <AppShell />
    </Router>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
