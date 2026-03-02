import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme, AVAILABLE_THEMES } from '../contexts/ThemeContext';
import { getBooks, saveBooks, syncBooksFromServer } from '../utils/bookStorage';

const EMPTY_STATS = {
  totalBooks: 0,
  booksRead: 0,
  currentlyReading: 0,
  unread: 0,
  wishlist: 0
};

const normalizeStatus = (status) => {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'read') return 'read';
  if (value === 'currently reading' || value === 'currently-reading' || value === 'reading') return 'currently reading';
  if (value === 'unread' || value === 'did not finish' || value === 'did-not-finish' || value === 'dnf') return 'unread';
  if (value === 'wishlist' || value === 'wish list' || value === 'wish') return 'wishlist';
  return value;
};

const buildStatsFromBooks = (books) => {
  const normalizedBooks = Array.isArray(books) ? books : [];
  let booksRead = 0;
  let currentlyReading = 0;
  let unread = 0;
  let wishlist = 0;

  normalizedBooks.forEach((book) => {
    const status = normalizeStatus(book?.status);
    if (status === 'read') booksRead += 1;
    if (status === 'currently reading') currentlyReading += 1;
    if (status === 'unread') unread += 1;
    if (status === 'wishlist') wishlist += 1;
  });

  return {
    totalBooks: normalizedBooks.length,
    booksRead,
    currentlyReading,
    unread,
    wishlist
  };
};

const buildStatsSignature = (stats) => (
  `${stats.totalBooks}|${stats.booksRead}|${stats.currentlyReading}|${stats.unread}|${stats.wishlist}`
);

const Settings = ({ isInOffcanvas = false, currentUser = null, onSignOut = null }) => {
  const navigate = useNavigate();
  const { theme, changeTheme } = useTheme();
  const [stats, setStats] = useState(EMPTY_STATS);
  const statsSignatureRef = useRef(buildStatsSignature(EMPTY_STATS));
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('defaultViewMode') || 'list');
  const [notice, setNotice] = useState(null);

  const completionRate = useMemo(() => {
    const completionBase = Math.max(0, stats.totalBooks - stats.wishlist);
    if (completionBase === 0) return 0;
    return Math.min(100, Math.round((stats.booksRead / completionBase) * 100));
  }, [stats.booksRead, stats.totalBooks, stats.wishlist]);

  useEffect(() => {
    const loadStats = async ({ syncRemote = false } = {}) => {
      if (syncRemote) {
        await syncBooksFromServer();
      }
      const books = getBooks();
      const nextStats = buildStatsFromBooks(books);
      const nextSignature = buildStatsSignature(nextStats);
      if (nextSignature === statsSignatureRef.current) return;

      statsSignatureRef.current = nextSignature;
      setStats(nextStats);
    };

    const handleStorageEvent = (event) => {
      if (!event || event.key === 'bookHubBooks' || event.key === null) {
        void loadStats();
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void loadStats({ syncRemote: true });
      }
    };

    void loadStats({ syncRemote: true });
    const booksUpdateHandler = () => {
      void loadStats();
    };
    const focusHandler = () => {
      void loadStats({ syncRemote: true });
    };

    window.addEventListener('booksUpdated', booksUpdateHandler);
    window.addEventListener('storage', handleStorageEvent);
    window.addEventListener('focus', focusHandler);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const refreshInterval = window.setInterval(() => {
      void loadStats({ syncRemote: true });
    }, 9000);

    return () => {
      window.removeEventListener('booksUpdated', booksUpdateHandler);
      window.removeEventListener('storage', handleStorageEvent);
      window.removeEventListener('focus', focusHandler);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(refreshInterval);
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem('defaultViewMode', mode);
    setNotice({ type: 'success', message: `Default view updated to ${mode} mode.` });
  };

  const exportLibrary = async () => {
    try {
      await syncBooksFromServer();
      const books = getBooks();
      const data = {
        exportDate: new Date().toISOString(),
        totalBooks: books.length,
        books
      };
      const dataStr = JSON.stringify(data, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `library-backup-${new Date().getTime()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice({ type: 'success', message: 'Library export created.' });
    } catch {
      setNotice({ type: 'error', message: 'Export failed. Please try again.' });
    }
  };

  const importLibrary = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (readEvent) => {
      try {
        const parsed = JSON.parse(String(readEvent.target?.result || '{}'));
        if (!parsed.books || !Array.isArray(parsed.books)) {
          setNotice({ type: 'error', message: 'Invalid file format. Use a BookHub export file.' });
          return;
        }
        await saveBooks(parsed.books);
        window.dispatchEvent(new Event('booksUpdated'));
        setNotice({ type: 'success', message: `Imported ${parsed.books.length} books.` });
      } catch {
        setNotice({ type: 'error', message: 'Could not read that file. Please use a valid JSON export.' });
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const clearAllData = async () => {
    if (!window.confirm('Delete all books from your library? This cannot be undone.')) return;
    await saveBooks([]);
    window.dispatchEvent(new Event('booksUpdated'));
    setNotice({ type: 'success', message: 'Library cleared.' });
  };

  const handleAccountAction = () => {
    if (currentUser && onSignOut) {
      void onSignOut();
      return;
    }
    navigate('/login');
  };

  return (
    <div className={`${isInOffcanvas ? 'settings-shell settings-shell-embedded' : 'glass-container settings-shell'}`}>
      <div className="settings-header-row">
        <div>
          <h2 className="mb-1">Settings</h2>
          <p className="settings-subtitle mb-0">Personalize your reading experience and manage library data.</p>
        </div>
      </div>

      {notice && (
        <div className={`settings-notice ${notice.type === 'error' ? 'error' : 'success'}`} role="status">
          {notice.message}
        </div>
      )}

      <section className="card mb-3 settings-section-card">
        <div className="card-header bg-transparent border-bottom settings-section-header">
          <h5 className="mb-0">Library Statistics</h5>
          <small>Updated automatically from your current library.</small>
        </div>
        <div className="card-body">
          <div className="settings-stats-grid">
            <div className="settings-stat-tile tone-total">
              <div className="settings-stat-value">{stats.totalBooks}</div>
              <div className="settings-stat-label">Total Books</div>
            </div>
            <div className="settings-stat-tile tone-finished">
              <div className="settings-stat-value">{stats.booksRead}</div>
              <div className="settings-stat-label">Finished</div>
            </div>
            <div className="settings-stat-tile tone-reading">
              <div className="settings-stat-value">{stats.currentlyReading}</div>
              <div className="settings-stat-label">Currently Reading</div>
            </div>
            <div className="settings-stat-tile tone-dnf">
              <div className="settings-stat-value">{stats.unread}</div>
              <div className="settings-stat-label">Didn't Finish</div>
            </div>
            <div className="settings-stat-tile tone-wishlist">
              <div className="settings-stat-value">{stats.wishlist}</div>
              <div className="settings-stat-label">Wishlist</div>
            </div>
            <div className="settings-stat-tile tone-default">
              <div className="settings-stat-value">{completionRate}%</div>
              <div className="settings-stat-label">Completion Rate</div>
            </div>
          </div>
          <p className="settings-stats-note mb-0">Completion Rate excludes wishlist books.</p>
        </div>
      </section>

      <section className="card mb-3 settings-section-card">
        <div className="card-header bg-transparent border-bottom settings-section-header">
          <h5 className="mb-0">Display</h5>
          <small>Choose your theme and preferred default view.</small>
        </div>
        <div className="card-body">
          <label className="form-label mb-2">Theme</label>
          <div className="settings-theme-grid mb-3">
            {AVAILABLE_THEMES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`settings-theme-option ${theme === option.id ? 'active' : ''}`}
                style={{ '--theme-chip': option.color }}
                onClick={() => changeTheme(option.id)}
              >
                <span className="settings-theme-swatch" />
                <span className="settings-theme-name">{option.name}</span>
                {theme === option.id && <span className="settings-theme-check">Selected</span>}
              </button>
            ))}
          </div>

          <label className="form-label mb-2">Default View</label>
          <div className="settings-view-toggle" role="group" aria-label="Default view mode">
            <button
              type="button"
              className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => handleViewModeChange('list')}
            >
              List View
            </button>
            <button
              type="button"
              className={`btn ${viewMode === 'grid' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => handleViewModeChange('grid')}
            >
              Grid View
            </button>
          </div>
        </div>
      </section>

      <section className="card mb-3 settings-section-card">
        <div className="card-header bg-transparent border-bottom settings-section-header">
          <h5 className="mb-0">Data Management</h5>
          <small>Back up your library or reset when needed.</small>
        </div>
        <div className="card-body">
          <div className="settings-actions-grid">
            <button type="button" className="btn btn-primary w-100" onClick={exportLibrary}>
              Export Library
            </button>
            <label htmlFor="importFile" className="form-label mb-1">Import Library</label>
            <input
              type="file"
              id="importFile"
              className="form-control"
              accept=".json"
              onChange={importLibrary}
            />
            <small className="settings-file-help">Use a JSON file exported from BookHub.</small>
          </div>

          <div className="settings-danger-zone mt-3">
            <button type="button" className="btn btn-danger w-100" onClick={clearAllData}>
              Delete All Books
            </button>
          </div>
        </div>
      </section>

      <section className="card mb-3 settings-section-card">
        <div className="card-header bg-transparent border-bottom settings-section-header">
          <h5 className="mb-0">About</h5>
        </div>
        <div className="card-body settings-about-copy">
          <p className="mb-1"><strong>BookHub</strong> v1.0.0</p>
          <p className="mb-0">Organize your books, track progress, scan barcodes, and discover what your friends are reading.</p>
        </div>
      </section>

      <button className={`btn w-100 ${currentUser ? 'btn-outline-danger' : 'btn-outline-primary'}`} onClick={handleAccountAction}>
        {currentUser ? `Sign Out (${currentUser.email})` : 'Sign In'}
      </button>
    </div>
  );
};

export default Settings;
