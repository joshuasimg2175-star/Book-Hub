import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getFriendBooks, getFriends } from '../services/backend';
import { addBook } from '../utils/bookStorage';
import { getCurrentUser } from '../utils/authStorage';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'currently reading', label: 'Currently Reading' },
  { value: 'read', label: 'Finished' },
  { value: 'unread', label: "Didn't Finish" },
  { value: 'wishlist', label: 'Wishlist' }
];

const FEATURED_BATCH_SIZE = 6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FEATURED_DISCOVER_POOL = [
  {
    id: 'featured-1',
    title: 'The Midnight Library',
    authors: ['Matt Haig'],
    summary: 'A reflective novel about choices, regrets, and the lives we might have lived.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780525559474-L.jpg'
  },
  {
    id: 'featured-2',
    title: 'Tomorrow, and Tomorrow, and Tomorrow',
    authors: ['Gabrielle Zevin'],
    summary: 'A creative friendship story about games, ambition, and building worlds together.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780593321201-L.jpg'
  },
  {
    id: 'featured-3',
    title: 'Fourth Wing',
    authors: ['Rebecca Yarros'],
    summary: 'High-stakes fantasy with dragons, rivalry, and survival in a brutal war college.',
    cover: 'https://covers.openlibrary.org/b/isbn/9781649374042-L.jpg'
  },
  {
    id: 'featured-4',
    title: 'Project Hail Mary',
    authors: ['Andy Weir'],
    summary: 'A lone astronaut races to solve an extinction-level threat with science and humor.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780593135204-L.jpg'
  },
  {
    id: 'featured-5',
    title: 'Demon Copperhead',
    authors: ['Barbara Kingsolver'],
    summary: 'A modern coming-of-age story set in Appalachia with sharp voice and grit.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780063251922-L.jpg'
  },
  {
    id: 'featured-6',
    title: 'The House in the Cerulean Sea',
    authors: ['TJ Klune'],
    summary: 'A warm fantasy about found family, belonging, and choosing kindness.',
    cover: 'https://covers.openlibrary.org/b/isbn/9781250217288-L.jpg'
  },
  {
    id: 'featured-7',
    title: 'Yellowface',
    authors: ['R.F. Kuang'],
    summary: 'A sharp satire of publishing, ambition, and literary fame gone wrong.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780063250833-L.jpg'
  },
  {
    id: 'featured-8',
    title: 'Remarkably Bright Creatures',
    authors: ['Shelby Van Pelt'],
    summary: 'A heartfelt story of grief, connection, and an unforgettable giant Pacific octopus.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780063204157-L.jpg'
  },
  {
    id: 'featured-9',
    title: 'Legends & Lattes',
    authors: ['Travis Baldree'],
    summary: 'Cozy fantasy about building a coffee shop and a new life after battle.',
    cover: 'https://covers.openlibrary.org/b/isbn/9781250886088-L.jpg'
  },
  {
    id: 'featured-10',
    title: 'Babel',
    authors: ['R.F. Kuang'],
    summary: 'Dark academia, translation magic, and empire examined through language and power.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780063021426-L.jpg'
  },
  {
    id: 'featured-11',
    title: 'The Seven Husbands of Evelyn Hugo',
    authors: ['Taylor Jenkins Reid'],
    summary: 'A glamorous and emotional Hollywood story told through one final interview.',
    cover: 'https://covers.openlibrary.org/b/isbn/9781501161933-L.jpg'
  },
  {
    id: 'featured-12',
    title: 'Lessons in Chemistry',
    authors: ['Bonnie Garmus'],
    summary: 'A witty, uplifting novel about science, sexism, and self-determination.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780385547345-L.jpg'
  },
  {
    id: 'featured-13',
    title: 'The Book Thief',
    authors: ['Markus Zusak'],
    summary: 'A moving World War II story about words, loss, and quiet courage.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780375842207-L.jpg'
  },
  {
    id: 'featured-14',
    title: 'The Song of Achilles',
    authors: ['Madeline Miller'],
    summary: 'A lyrical retelling of Greek myth focused on love, destiny, and war.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780062060624-L.jpg'
  },
  {
    id: 'featured-15',
    title: 'The Night Circus',
    authors: ['Erin Morgenstern'],
    summary: 'A magical competition unfolds inside an enchanting circus that appears at night.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780307744432-L.jpg'
  },
  {
    id: 'featured-16',
    title: 'Circe',
    authors: ['Madeline Miller'],
    summary: 'A mythic, character-driven story of exile, transformation, and agency.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780316556347-L.jpg'
  },
  {
    id: 'featured-17',
    title: 'The Invisible Life of Addie LaRue',
    authors: ['V.E. Schwab'],
    summary: 'A sweeping fantasy about memory, identity, and the cost of being forgotten.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780765387561-L.jpg'
  },
  {
    id: 'featured-18',
    title: 'Klara and the Sun',
    authors: ['Kazuo Ishiguro'],
    summary: 'A thoughtful story about love, technology, and what it means to be human.',
    cover: 'https://covers.openlibrary.org/b/isbn/9780593318171-L.jpg'
  }
];

const startOfLocalWeek = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const weekday = date.getDay();
  const daysFromMonday = (weekday + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);
  return date;
};

const weekSeed = (value) => Math.floor(startOfLocalWeek(value).getTime() / WEEK_MS);

const seededRandom = (seed) => {
  let nextSeed = seed;
  return () => {
    nextSeed = (nextSeed * 1664525 + 1013904223) % 4294967296;
    return nextSeed / 4294967296;
  };
};

const seededShuffle = (books, seed) => {
  const copy = [...books];
  const random = seededRandom(seed);
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

const normalizeStatus = (status) => {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'did not finish' || value === 'did-not-finish' || value === 'dnf') return 'unread';
  return value;
};

const statusLabel = (status) => {
  switch (normalizeStatus(status)) {
    case 'read':
      return 'Finished';
    case 'currently reading':
      return 'Currently Reading';
    case 'wishlist':
      return 'Wishlist';
    case 'unread':
      return "Didn't Finish";
    default:
      return 'Unknown';
  }
};

const statusToneClass = (status) => {
  switch (normalizeStatus(status)) {
    case 'read':
      return 'tone-finished';
    case 'currently reading':
      return 'tone-reading';
    case 'wishlist':
      return 'tone-wishlist';
    case 'unread':
      return 'tone-dnf';
    default:
      return 'tone-default';
  }
};

const formatTimelineDate = (timestamp) => {
  const date = new Date(timestamp);
  const now = Date.now();
  const diff = now - date.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  if (diff < dayMs) return 'Today';
  if (diff < 2 * dayMs) return 'Yesterday';
  if (diff < 7 * dayMs) return `${Math.max(2, Math.floor(diff / dayMs))} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const formatLongDate = (timestamp) =>
  new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

const formatTimelineClock = (timestamp) =>
  new Date(timestamp).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });

const dayStartTimestamp = (timestamp) => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const formatTimelineDayLabel = (timestamp) => {
  const dayTs = dayStartTimestamp(timestamp);
  const todayTs = dayStartTimestamp(Date.now());
  const diffDays = Math.round((todayTs - dayTs) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return `${diffDays} Days Ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const formatTimelineDayMeta = (timestamp) =>
  new Date(timestamp).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

const hasSpoilerThoughts = (book) =>
  Boolean(String(book?.thoughts || '').trim()) && Boolean(book?.thoughtsContainSpoilers);

const excerptText = (book) => {
  if (hasSpoilerThoughts(book)) {
    return 'Spoiler thoughts hidden. Open details to reveal.';
  }
  const source = String(book?.thoughts || book?.summary || book?.description || '').trim();
  if (!source) return 'No note shared yet.';
  return source.length > 140 ? `${source.slice(0, 140).trim()}...` : source;
};

const shortSummary = (book) => {
  const source = String(book?.summary || book?.description || '').trim();
  if (!source) return 'No summary available yet.';
  return source.length > 96 ? `${source.slice(0, 96).trim()}...` : source;
};

const friendHandle = (friend) => {
  const username = String(friend?.username || '').trim();
  if (username) return `@${username}`;
  return String(friend?.name || 'Reader');
};

const HomeTimeline = () => {
  const currentUserId = getCurrentUser()?.id || 1;
  const [friends, setFriends] = useState([]);
  const [timelineBooks, setTimelineBooks] = useState([]);
  const [timelineFriendFilter, setTimelineFriendFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedBookFriend, setSelectedBookFriend] = useState('');
  const [selectedBookContext, setSelectedBookContext] = useState('timeline');
  const [showSpoilerThoughts, setShowSpoilerThoughts] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [discoverTab, setDiscoverTab] = useState('popular');
  const [featuredClock, setFeaturedClock] = useState(() => Date.now());

  const loadTimelineData = useCallback(async ({ refresh = false } = {}) => {
    setLoadError('');
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const myFriends = await getFriends(currentUserId);
      const now = Date.now();

      const friendPayloads = await Promise.all(
        myFriends.map(async (friend, friendIndex) => {
          const friendBooks = await getFriendBooks(friend.id);
          const normalizedBooks = friendBooks.map((book, bookIndex) => {
            const parsedTs = Date.parse(book?.addedAt || book?.updatedAt || book?.createdAt || '');
            const fallbackTs = now - (friendIndex * 24 + bookIndex + 1) * 60 * 60 * 1000;
            return {
              ...book,
              friendId: friend.id,
              friendName: friendHandle(friend),
              timelineTs: Number.isNaN(parsedTs) ? fallbackTs : parsedTs
            };
          });
          return { friend, books: normalizedBooks };
        })
      );

      const mergedTimeline = friendPayloads
        .flatMap(({ books }) => books)
        .sort((a, b) => b.timelineTs - a.timelineTs);

      setFriends(myFriends);
      setTimelineBooks(mergedTimeline);

      if (refresh) {
        setNotice({ type: 'success', message: 'Timeline refreshed.' });
      }
    } catch {
      setLoadError('Could not load timeline right now. Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    void loadTimelineData();
  }, [loadTimelineData]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFeaturedClock(Date.now());
    }, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedBook) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedBook]);

  const filteredTimelineBooks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return timelineBooks.filter((book) => {
      if (timelineFriendFilter !== 'all' && book.friendId !== timelineFriendFilter) return false;
      if (statusFilter !== 'all' && normalizeStatus(book.status) !== statusFilter) return false;
      if (!query) return true;

      const searchable = [
        book.title,
        ...(Array.isArray(book.authors) ? book.authors : []),
        book.friendName,
        book.summary,
        book.description,
        book.thoughts
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [timelineBooks, timelineFriendFilter, statusFilter, searchQuery]);

  const groupedTimelineBooks = useMemo(() => {
    const groupedMap = new Map();

    filteredTimelineBooks.forEach((book) => {
      const dayTs = dayStartTimestamp(book.timelineTs);
      if (!groupedMap.has(dayTs)) {
        groupedMap.set(dayTs, []);
      }
      groupedMap.get(dayTs).push(book);
    });

    return Array.from(groupedMap.entries())
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([dayTs, books]) => ({
        dayTs: Number(dayTs),
        books: [...books].sort((a, b) => b.timelineTs - a.timelineTs)
      }));
  }, [filteredTimelineBooks]);

  const popularDiscoverBooks = useMemo(() => {
    const indexed = new Map();

    timelineBooks.forEach((book) => {
      const title = String(book?.title || '').trim();
      if (!title) return;

      const authors = (Array.isArray(book?.authors) ? book.authors : [book?.authors])
        .map((author) => String(author || '').trim())
        .filter(Boolean);
      const key = `${title.toLowerCase()}|${authors.join('|').toLowerCase()}`;
      const entry = indexed.get(key);
      const timelineTs = Number(book?.timelineTs) || 0;
      const cover = String(book?.cover || '').trim();
      const summary = String(book?.summary || book?.description || '').trim();

      if (entry) {
        entry.popularity += 1;
        if (timelineTs > entry.timelineTs) {
          entry.timelineTs = timelineTs;
          if (cover) entry.cover = cover;
          if (summary) entry.summary = summary;
        }
        return;
      }

      indexed.set(key, {
        id: `popular-${key}`,
        title,
        authors: authors.length > 0 ? authors : ['Unknown Author'],
        summary,
        cover,
        popularity: 1,
        timelineTs
      });
    });

    return Array.from(indexed.values())
      .sort((a, b) => {
        if (b.popularity !== a.popularity) return b.popularity - a.popularity;
        return b.timelineTs - a.timelineTs;
      })
      .slice(0, 8);
  }, [timelineBooks]);

  const featuredDiscoverBooks = useMemo(() => {
    const seed = weekSeed(featuredClock);
    return seededShuffle(FEATURED_DISCOVER_POOL, seed).slice(0, FEATURED_BATCH_SIZE);
  }, [featuredClock]);

  const discoverBooks = discoverTab === 'popular'
    ? popularDiscoverBooks
    : featuredDiscoverBooks;

  const closeModal = () => {
    setSelectedBook(null);
    setSelectedBookFriend('');
    setSelectedBookContext('timeline');
    setShowSpoilerThoughts(false);
  };

  const openBookModal = (book, context = 'timeline') => {
    setSelectedBook(book);
    setSelectedBookContext(context);
    setSelectedBookFriend(book.friendName || 'Friend');
    setShowSpoilerThoughts(false);
  };

  const addToWishlist = (book, { closeAfter = false } = {}) => {
    const savedBook = addBook({
      ...book,
      status: 'wishlist',
      summary: book.summary || book.description || '',
      description: book.description || book.summary || '',
      thoughtsContainSpoilers: Boolean(book?.thoughtsContainSpoilers)
    });

    if (savedBook) {
      setNotice({ type: 'success', message: `"${book.title}" added to your wishlist.` });
    } else {
      setNotice({ type: 'error', message: 'Could not add this book to your wishlist.' });
    }

    if (closeAfter) closeModal();
  };

  const addDiscoverBookToWishlist = (book) => {
    const savedBook = addBook({
      ...book,
      status: 'wishlist',
      summary: book.summary || book.description || '',
      description: book.description || book.summary || '',
      thoughts: book.thoughts || '',
      thoughtsContainSpoilers: Boolean(book?.thoughtsContainSpoilers)
    });

    if (savedBook) {
      setNotice({ type: 'success', message: `"${book.title}" added to your wishlist.` });
      return;
    }

    setNotice({ type: 'error', message: 'Could not add this book to your wishlist.' });
  };

  const modalSummary = selectedBook
    ? String(selectedBook.description || selectedBook.summary || '').trim() || 'No summary available.'
    : '';
  const isTimelineDetails = selectedBookContext === 'timeline';
  const isFeaturedDetails = selectedBookContext === 'featured';
  const isPopularDetails = selectedBookContext === 'popular';

  const detailsModal = selectedBook ? (
    <div
      className="modal show d-block friend-details-modal"
      tabIndex="-1"
      role="dialog"
      aria-modal="true"
      onClick={closeModal}
    >
      <div
        className="modal-dialog modal-lg modal-dialog-centered friend-details-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-content glass-container">
          <div className="modal-header">
            <h5 className="modal-title">{selectedBook.title}</h5>
            <button type="button" className="btn-close" onClick={closeModal} aria-label="Close" />
          </div>
          <div className="modal-body">
            <div className="row">
              <div className="col-md-4">
                <img
                  src={selectedBook.cover || `https://via.placeholder.com/300x400?text=${encodeURIComponent(selectedBook.title)}`}
                  className="img-fluid"
                  alt={selectedBook.title}
                />
              </div>
              <div className="col-md-8">
                <p><strong>Authors:</strong> {selectedBook.authors?.join(', ') || 'Unknown Author'}</p>
                {isTimelineDetails && (
                  <p><strong>Status:</strong> {statusLabel(selectedBook.status)}</p>
                )}
                {(isFeaturedDetails || isPopularDetails) && (
                  <p>
                    <strong>Source:</strong> {isFeaturedDetails ? 'Featured this week' : 'Popular with friends'}
                  </p>
                )}
                {isPopularDetails && (
                  <p>
                    <strong>Popularity:</strong> {selectedBook.popularity || 1} shelf{(selectedBook.popularity || 1) === 1 ? '' : 's'}
                  </p>
                )}
                <div className="mt-3">
                  <strong>Summary:</strong>
                  <p className="mt-2">{modalSummary}</p>
                </div>
                {isTimelineDetails && (
                  <div className="mt-3">
                    <strong>{selectedBookFriend || 'Friend'}'s Thoughts:</strong>
                    {hasSpoilerThoughts(selectedBook) && !showSpoilerThoughts ? (
                      <div className="spoiler-thoughts-block mt-2">
                        <p className="mb-2">This thought is marked as a spoiler.</p>
                        <button
                          type="button"
                          className="btn btn-outline-primary btn-sm"
                          onClick={() => setShowSpoilerThoughts(true)}
                        >
                          Reveal Spoiler Thoughts
                        </button>
                      </div>
                    ) : (
                      <p className="mt-2">{selectedBook.thoughts || 'No thoughts shared yet.'}</p>
                    )}
                  </div>
                )}
                <div className="mt-3 d-flex gap-2 flex-wrap">
                  <button type="button" className="btn btn-primary" onClick={() => addToWishlist(selectedBook, { closeAfter: true })}>
                    Add to Wishlist
                  </button>
                  <button type="button" className="btn btn-outline-secondary" onClick={closeModal}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="glass-container home-feed-shell">
      <div className="home-feed-header mb-3">
        <div>
          <div className="home-feed-kicker">BookHub Home</div>
          <h2 className="mb-1">Home</h2>
          <p className="home-feed-subtitle mb-0">See what your friends are reading right now.</p>
        </div>
        <div className="home-feed-actions">
          <span className="home-feed-count">{friends.length} friends</span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={isLoading || isRefreshing}
            onClick={() => void loadTimelineData({ refresh: true })}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {notice && (
        <div className={`friends-notice ${notice.type === 'error' ? 'error' : 'success'}`} role="status">
          {notice.message}
        </div>
      )}

      {loadError && (
        <div className="friends-notice error" role="alert">
          {loadError}
        </div>
      )}

      <section className="home-discover-card mb-3" aria-label="Discover books">
        <div className="home-discover-head">
          <div>
            <h5 className="mb-1">Discover</h5>
            <p className="mb-0">Browse popular books from your network and curated featured picks that refresh every week.</p>
          </div>
          <div className="home-discover-toggle" role="group" aria-label="Discover category">
            <button
              type="button"
              className={`btn btn-sm ${discoverTab === 'popular' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setDiscoverTab('popular')}
            >
              Popular
            </button>
            <button
              type="button"
              className={`btn btn-sm ${discoverTab === 'featured' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setDiscoverTab('featured')}
            >
              Featured
            </button>
          </div>
        </div>
        {discoverTab === 'popular' && popularDiscoverBooks.length === 0 ? (
          <div className="timeline-empty home-discover-empty">No popular books yet. Add friends to grow recommendations.</div>
        ) : (
          <div className="home-discover-row">
            {discoverBooks.map((book) => (
              <article
                key={book.id}
                className="home-discover-item home-discover-item-clickable"
                role="button"
                tabIndex={0}
                aria-label={`View details for ${book.title}`}
                onClick={() => openBookModal(book, discoverTab === 'featured' ? 'featured' : 'popular')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openBookModal(book, discoverTab === 'featured' ? 'featured' : 'popular');
                  }
                }}
              >
                <img
                  src={book.cover || `https://via.placeholder.com/120x180?text=${encodeURIComponent(book.title)}`}
                  alt={book.title}
                  className="home-discover-cover"
                />
                <div className="home-discover-body">
                  <div className="home-discover-meta-row">
                    <span className={`home-discover-tag ${discoverTab === 'featured' ? 'featured' : 'popular'}`}>
                      {discoverTab === 'popular' ? `${book.popularity || 1} shelf${(book.popularity || 1) === 1 ? '' : 's'}` : 'Featured'}
                    </span>
                  </div>
                  <h6 className="home-discover-title">{book.title}</h6>
                  <p className="home-discover-authors">{book.authors?.join(', ') || 'Unknown Author'}</p>
                  <p className="home-discover-summary">{shortSummary(book)}</p>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm w-100 mb-2"
                    onClick={(event) => {
                      event.stopPropagation();
                      openBookModal(book, discoverTab === 'featured' ? 'featured' : 'popular');
                    }}
                  >
                    View Details
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm w-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      addDiscoverBookToWishlist(book);
                    }}
                  >
                    Add to Wishlist
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="home-feed-card">
        {isLoading ? (
          <div className="timeline-empty">Loading friend activity...</div>
        ) : (
          <>
            <div className="friends-chip-row">
              <button
                type="button"
                className={`friends-chip ${timelineFriendFilter === 'all' ? 'active' : ''}`}
                onClick={() => setTimelineFriendFilter('all')}
              >
                All Friends
              </button>
              {friends.map((friend) => (
                <button
                  key={friend.id}
                  type="button"
                  className={`friends-chip ${timelineFriendFilter === friend.id ? 'active' : ''}`}
                  onClick={() => setTimelineFriendFilter(friend.id)}
                >
                  {friendHandle(friend)}
                </button>
              ))}
            </div>

            <div className="friends-toolbar">
              <input
                type="search"
                className="form-control"
                placeholder="Search timeline..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <div className="friends-status-row">
                {STATUS_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    className={`status-filter-chip ${statusFilter === filter.value ? 'active' : ''}`}
                    onClick={() => setStatusFilter(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            {groupedTimelineBooks.length === 0 ? (
              <div className="timeline-empty">No timeline items match your filters.</div>
            ) : (
              <div className="timeline-feed-wrap home-timeline-feed-wrap">
                <div className="timeline-feed home-timeline-feed">
                  {groupedTimelineBooks.map((group) => (
                    <section key={group.dayTs} className="timeline-day-group">
                      <header className="timeline-day-header">
                        <div className="timeline-day-pill">
                          <span className="timeline-day-title">{formatTimelineDayLabel(group.dayTs)}</span>
                          <span className="timeline-day-meta">{formatTimelineDayMeta(group.dayTs)}</span>
                        </div>
                      </header>
                      <div className="timeline-day-events">
                        {group.books.map((book, index) => (
                          <article key={`${book.friendId}-${book.id}-${book.timelineTs}`} className="timeline-event home-timeline-event">
                            <div className="timeline-event-rail" aria-hidden="true">
                              <span className={`timeline-event-dot ${statusToneClass(book.status)}`} />
                              {index < group.books.length - 1 && <span className="timeline-event-stem" />}
                            </div>
                            <time className="timeline-event-time" title={formatLongDate(book.timelineTs)}>
                              {formatTimelineClock(book.timelineTs)}
                            </time>
                            <div className="timeline-event-card">
                              <img
                                src={book.cover || `https://via.placeholder.com/80x120?text=${encodeURIComponent(book.title)}`}
                                className="timeline-event-cover"
                                alt={book.title}
                                onClick={() => openBookModal(book)}
                              />
                              <div className="timeline-event-main">
                                <div className="timeline-event-head">
                                  <div>
                                    <h6 className="mb-1 timeline-event-title" onClick={() => openBookModal(book)}>
                                      {book.title}
                                    </h6>
                                    <p className="timeline-event-meta mb-0">{book.authors?.join(', ') || 'Unknown Author'}</p>
                                  </div>
                                  <span className={`status-pill ${statusToneClass(book.status)}`}>
                                    {statusLabel(book.status)}
                                  </span>
                                </div>
                                <p className="timeline-event-byline mb-2">
                                  <strong className="friend-name-highlight">{book.friendName}</strong>
                                  <span aria-hidden="true"> • </span>
                                  <time title={formatLongDate(book.timelineTs)}>{formatTimelineDate(book.timelineTs)}</time>
                                  {hasSpoilerThoughts(book) && <span className="spoiler-pill ms-2">Spoiler</span>}
                                </p>
                                <p className="timeline-event-copy mb-2">{excerptText(book)}</p>
                                <div className="timeline-event-actions">
                                  <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => openBookModal(book)}>
                                    View Details
                                  </button>
                                  <button type="button" className="btn btn-primary btn-sm" onClick={() => addToWishlist(book)}>
                                    Add to Wishlist
                                  </button>
                                </div>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {detailsModal && typeof document !== 'undefined' ? createPortal(detailsModal, document.body) : null}
    </div>
  );
};

export default HomeTimeline;
