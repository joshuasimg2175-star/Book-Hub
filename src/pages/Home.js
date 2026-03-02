import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AddBookForm from '../components/AddBookForm';
import BookList from '../components/BookList';
import CategorySelector from '../components/CategorySelector';
import { v4 as uuidv4 } from 'uuid';
import { getBooks, saveBooks, syncBooksFromServer } from '../utils/bookStorage';
import { getCurrentUser } from '../utils/authStorage';

const normalizeMangaProgress = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return '';
    return parsed;
};

const normalizeArcTags = (value) => {
    const tags = Array.isArray(value)
        ? value
        : String(value || '').split(',');
    return [...new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))];
};

const formatActivityTimestamp = (timestamp) => {
    const parsed = Date.parse(timestamp || '');
    if (Number.isNaN(parsed)) return 'Unknown time';
    return new Date(parsed).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
};

const Home = () => {
    const [books, setBooks] = useState([]);
    const [filter, setFilter] = useState('all');
    const [viewMode, setViewMode] = useState(() => {
        return localStorage.getItem('defaultViewMode') || 'list';
    });
    const [searchQuery, setSearchQuery] = useState('');
    const [sortMode, setSortMode] = useState('library');
    const [isAddBookExpanded, setIsAddBookExpanded] = useState(() => {
        const saved = localStorage.getItem('homeAddBookExpanded');
        if (saved === null) return false;
        return saved === 'true';
    });
    const [isActivityExpanded, setIsActivityExpanded] = useState(() => {
        const saved = localStorage.getItem('homeActivityExpanded');
        if (saved === null) return true;
        return saved === 'true';
    });
    const [pendingRemoveBook, setPendingRemoveBook] = useState(null);

    const loadBooksFromStorage = useCallback(async ({ syncRemote = false } = {}) => {
        if (syncRemote) {
            await syncBooksFromServer();
        }

        const savedBooks = getBooks();
        if (savedBooks.length === 0 && !getCurrentUser()) {
            // Keep sample books only for unsigned local mode.
            const exampleBooks = [
                {
                    id: '1',
                    title: 'The Great Gatsby',
                    authors: ['F. Scott Fitzgerald'],
                    summary: 'A classic American novel set in the Jazz Age, following the mysterious millionaire Jay Gatsby.',
                    cover: 'https://covers.openlibrary.org/b/id/7358216-M.jpg',
                    status: 'read',
                    thoughts: 'A timeless story about the American Dream and its disillusionment.'
                },
                {
                    id: '2',
                    title: 'To Kill a Mockingbird',
                    authors: ['Harper Lee'],
                    summary: 'A gripping tale of racial injustice and childhood innocence in the American South.',
                    cover: 'https://covers.openlibrary.org/b/id/8225261-M.jpg',
                    status: 'currently reading',
                    thoughts: 'Powerful themes that still resonate today.'
                },
                {
                    id: '3',
                    title: '1984',
                    authors: ['George Orwell'],
                    summary: 'A dystopian novel about totalitarianism, surveillance, and the power of language.',
                    cover: 'https://covers.openlibrary.org/b/id/7222246-M.jpg',
                    status: 'unread',
                    thoughts: ''
                },
                {
                    id: '4',
                    title: 'Pride and Prejudice',
                    authors: ['Jane Austen'],
                    summary: 'A romantic novel about manners, upbringing, morality, and marriage in early 19th-century England.',
                    cover: 'https://covers.openlibrary.org/b/id/8231859-M.jpg',
                    status: 'read',
                    thoughts: 'Elizabeth Bennet is such a relatable character!'
                },
                {
                    id: '5',
                    title: 'The Catcher in the Rye',
                    authors: ['J.D. Salinger'],
                    summary: 'A controversial novel about teenage rebellion and alienation.',
                    cover: 'https://covers.openlibrary.org/b/id/8303088-M.jpg',
                    status: 'currently reading',
                    thoughts: 'Holden Caulfield is quite the character.'
                }
            ];
            setBooks(exampleBooks);
            await saveBooks(exampleBooks);
            return;
        }

        setBooks(savedBooks);
    }, []);

    useEffect(() => {
        void loadBooksFromStorage({ syncRemote: true });

        const handleBooksUpdate = () => {
            void loadBooksFromStorage();
        };

        window.addEventListener('booksUpdated', handleBooksUpdate);
        window.addEventListener('focus', handleBooksUpdate);
        const remoteSyncTimer = window.setInterval(() => {
            void loadBooksFromStorage({ syncRemote: true });
        }, 10000);

        return () => {
            window.removeEventListener('booksUpdated', handleBooksUpdate);
            window.removeEventListener('focus', handleBooksUpdate);
            window.clearInterval(remoteSyncTimer);
        };
    }, [loadBooksFromStorage]);

    useEffect(() => {
        localStorage.setItem('homeAddBookExpanded', String(isAddBookExpanded));
    }, [isAddBookExpanded]);

    useEffect(() => {
        localStorage.setItem('defaultViewMode', viewMode);
    }, [viewMode]);

    useEffect(() => {
        localStorage.setItem('homeActivityExpanded', String(isActivityExpanded));
    }, [isActivityExpanded]);

    useEffect(() => {
        if (!pendingRemoveBook) return undefined;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [pendingRemoveBook]);

    const handleBookAdd = (book) => {
        const nowIso = new Date().toISOString();
        const newBook = {
            ...book,
            id: uuidv4(),
            thoughtsContainSpoilers: Boolean(book?.thoughtsContainSpoilers),
            addedAt: String(book?.addedAt || '').trim() || nowIso,
            updatedAt: nowIso
        };
        setBooks((previousBooks) => {
            const updatedBooks = [...previousBooks, newBook];
            void saveBooks(updatedBooks);
            return updatedBooks;
        });
    };

    const handleStatusChange = (bookId, newStatus) => {
        setBooks((previousBooks) => {
            const updatedBooks = previousBooks.map(book =>
                book.id === bookId ? { ...book, status: newStatus, updatedAt: new Date().toISOString() } : book
            );
            void saveBooks(updatedBooks);
            return updatedBooks;
        });
    };

    const handleThoughtsChange = (bookId, newThoughts) => {
        setBooks((previousBooks) => {
            const updatedBooks = previousBooks.map(book =>
                book.id === bookId ? { ...book, thoughts: newThoughts, updatedAt: new Date().toISOString() } : book
            );
            void saveBooks(updatedBooks);
            return updatedBooks;
        });
    };

    const handleThoughtsSpoilerChange = (bookId, containsSpoilers) => {
        setBooks((previousBooks) => {
            const updatedBooks = previousBooks.map((book) => (
                book.id === bookId
                    ? { ...book, thoughtsContainSpoilers: Boolean(containsSpoilers), updatedAt: new Date().toISOString() }
                    : book
            ));
            void saveBooks(updatedBooks);
            return updatedBooks;
        });
    };

    const handleMangaMetaChange = (bookId, updates = {}) => {
        setBooks((previousBooks) => {
            let changed = false;
            const updatedBooks = previousBooks.map((book) => {
                if (String(book.id) !== String(bookId)) return book;
                if (String(book?.mediaType || '').trim().toLowerCase() !== 'manga') return book;

                const nextBook = { ...book };
                if (Object.prototype.hasOwnProperty.call(updates, 'mangaVolume')) {
                    nextBook.mangaVolume = normalizeMangaProgress(updates.mangaVolume);
                    changed = true;
                }
                if (Object.prototype.hasOwnProperty.call(updates, 'mangaChapter')) {
                    nextBook.mangaChapter = normalizeMangaProgress(updates.mangaChapter);
                    changed = true;
                }
                if (Object.prototype.hasOwnProperty.call(updates, 'arcTags')) {
                    nextBook.arcTags = normalizeArcTags(updates.arcTags);
                    changed = true;
                }
                if (changed) {
                    nextBook.updatedAt = new Date().toISOString();
                }
                return nextBook;
            });

            if (changed) {
                void saveBooks(updatedBooks);
                return updatedBooks;
            }
            return previousBooks;
        });
    };

    const handleRemoveBook = (bookId) => {
        const book = books.find((entry) => String(entry.id) === String(bookId));
        setPendingRemoveBook({
            id: String(bookId),
            title: book?.title || 'this book'
        });
    };

    const cancelRemoveBook = () => {
        setPendingRemoveBook(null);
    };

    const confirmRemoveBook = () => {
        if (!pendingRemoveBook?.id) return;
        const removeId = String(pendingRemoveBook.id);
        setBooks((previousBooks) => {
            const nextBooks = previousBooks.filter((entry) => String(entry.id) !== removeId);
            void saveBooks(nextBooks);
            return nextBooks;
        });
        setPendingRemoveBook(null);
    };

    const normalizeStatus = (status) => {
        const value = String(status || '').trim().toLowerCase();
        if (value === 'did not finish' || value === 'did-not-finish' || value === 'dnf') return 'unread';
        return value;
    };

    const stats = useMemo(() => {
        const result = {
            total: books.length,
            finished: 0,
            reading: 0,
            didNotFinish: 0,
            wishlist: 0
        };

        books.forEach((book) => {
            const status = normalizeStatus(book.status);
            if (status === 'read') result.finished += 1;
            if (status === 'currently reading') result.reading += 1;
            if (status === 'unread') result.didNotFinish += 1;
            if (status === 'wishlist') result.wishlist += 1;
        });

        return result;
    }, [books]);

    const readingActivity = useMemo(() => {
        const statusCopy = (status) => {
            const normalized = normalizeStatus(status);
            if (normalized === 'read') return 'marked as Finished';
            if (normalized === 'currently reading') return 'moved to Currently Reading';
            if (normalized === 'wishlist') return 'saved to Wishlist';
            if (normalized === 'unread') return "moved to Didn't Finish";
            return 'updated';
        };

        return [...books]
            .map((book) => {
                const activityAt = String(book?.updatedAt || book?.addedAt || '').trim();
                const parsedTs = Date.parse(activityAt);
                const progressBits = [];
                if (String(book?.mangaVolume ?? '').trim()) progressBits.push(`Vol ${book.mangaVolume}`);
                if (String(book?.mangaChapter ?? '').trim()) progressBits.push(`Ch ${book.mangaChapter}`);

                return {
                    id: `${book.id}-${activityAt || 'no-time'}`,
                    title: book.title || 'Unknown Title',
                    cover: book.cover || '',
                    action: statusCopy(book.status),
                    timestamp: activityAt,
                    ts: Number.isNaN(parsedTs) ? 0 : parsedTs,
                    isManga: String(book?.mediaType || '').trim().toLowerCase() === 'manga',
                    progress: progressBits.join(' • '),
                    hasSpoilerThoughts: Boolean(book?.thoughts) && Boolean(book?.thoughtsContainSpoilers)
                };
            })
            .sort((a, b) => b.ts - a.ts)
            .slice(0, 10);
    }, [books]);

    const libraryBooks = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();

        const filtered = books.filter((book) => {
            if (filter !== 'all' && normalizeStatus(book.status) !== filter) return false;
            if (!normalizedQuery) return true;

            const searchable = [
                book.title,
                ...(Array.isArray(book.authors) ? book.authors : [book.authors]),
                book.summary,
                book.description,
                book.thoughts,
                ...(Array.isArray(book.arcTags) ? book.arcTags : [book.arcTags])
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            return searchable.includes(normalizedQuery);
        });

        if (sortMode === 'title-asc') {
            return [...filtered].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
        }

        if (sortMode === 'title-desc') {
            return [...filtered].sort((a, b) => String(b.title || '').localeCompare(String(a.title || '')));
        }

        if (sortMode === 'author-asc') {
            return [...filtered].sort((a, b) => {
                const firstAuthorA = Array.isArray(a.authors) ? a.authors[0] || '' : a.authors || '';
                const firstAuthorB = Array.isArray(b.authors) ? b.authors[0] || '' : b.authors || '';
                return String(firstAuthorA).localeCompare(String(firstAuthorB));
            });
        }

        if (sortMode === 'status') {
            const statusOrder = {
                'currently reading': 0,
                read: 1,
                unread: 2,
                wishlist: 3
            };
            return [...filtered].sort((a, b) => {
                const rankA = statusOrder[normalizeStatus(a.status)] ?? 99;
                const rankB = statusOrder[normalizeStatus(b.status)] ?? 99;
                if (rankA !== rankB) return rankA - rankB;
                return String(a.title || '').localeCompare(String(b.title || ''));
            });
        }

        return filtered;
    }, [books, filter, searchQuery, sortMode]);

    return (
        <div className="glass-container home-shell">
            <div className="home-header mb-4">
                <div>
                    <h1 className="mb-1">My Shelf</h1>
                    <p className="home-subtitle mb-0">Organize your personal library and keep your reading progress up to date.</p>
                </div>
                <div className="home-metrics">
                    <span className="home-metric-pill metric-total"><strong>{stats.total}</strong> Total</span>
                    <span className="home-metric-pill metric-finished"><strong>{stats.finished}</strong> Finished</span>
                    <span className="home-metric-pill metric-reading"><strong>{stats.reading}</strong> Reading</span>
                    <span className="home-metric-pill metric-dnf"><strong>{stats.didNotFinish}</strong> Didn't Finish</span>
                    <span className="home-metric-pill metric-wishlist"><strong>{stats.wishlist}</strong> Wishlist</span>
                </div>
            </div>
            <section className={`add-book-collapsible ${isAddBookExpanded ? 'expanded' : 'collapsed'}`}>
                <button
                    type="button"
                    className="add-book-collapse-toggle"
                    onClick={() => setIsAddBookExpanded((current) => !current)}
                    aria-expanded={isAddBookExpanded}
                    aria-controls="add-book-collapse-panel"
                >
                    <span className="add-book-collapse-copy">
                        <span className="add-book-collapse-title">
                            {isAddBookExpanded ? 'Hide Add a Book' : 'Add a Book'}
                        </span>
                        <span className="add-book-collapse-subtitle">
                            {isAddBookExpanded
                                ? 'Collapse this section to keep your library front and center.'
                                : 'Expand to add by ISBN, manual entry, or camera scan.'}
                        </span>
                    </span>
                    <span className={`add-book-collapse-chevron ${isAddBookExpanded ? 'open' : ''}`} aria-hidden="true">
                        ▾
                    </span>
                </button>
                <div id="add-book-collapse-panel" className="add-book-collapse-panel">
                    <div className="add-book-collapse-inner">
                        <AddBookForm onBookAdd={handleBookAdd} isExpanded={isAddBookExpanded} />
                    </div>
                </div>
            </section>

            <div className="home-controls mb-3">
                <div className="home-search-wrap">
                    <label htmlFor="homeSearch" className="home-control-label">Search Library</label>
                    <input
                        id="homeSearch"
                        type="search"
                        className="form-control home-search-input"
                        placeholder="Search by title, author, summary, or thoughts..."
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                    />
                </div>
                <div className="home-sort-wrap">
                    <label htmlFor="homeSort" className="home-control-label">Sort</label>
                    <select
                        id="homeSort"
                        className="form-select home-sort-select"
                        value={sortMode}
                        onChange={(event) => setSortMode(event.target.value)}
                    >
                        <option value="library">Library Order</option>
                        <option value="title-asc">Title (A-Z)</option>
                        <option value="title-desc">Title (Z-A)</option>
                        <option value="author-asc">Author (A-Z)</option>
                        <option value="status">Status</option>
                    </select>
                </div>
            </div>

            <CategorySelector onFilterChange={setFilter} currentFilter={filter} />

            <div className="home-list-toolbar mb-3">
                <div className="home-list-meta">
                    <span className="home-section-label">Library</span>
                    <small>{libraryBooks.length} showing</small>
                </div>
                <div className="view-toggle-wrap">
                    <div className="btn-group view-mode-toggle" role="group" aria-label="Book view mode">
                        <button
                            className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={() => setViewMode('list')}
                            type="button"
                        >
                            List View
                        </button>
                        <button
                            className={`btn ${viewMode === 'grid' ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={() => setViewMode('grid')}
                            type="button"
                        >
                            Grid View
                        </button>
                    </div>
                </div>
            </div>
            <BookList
                books={libraryBooks}
                onStatusChange={handleStatusChange}
                onThoughtsChange={handleThoughtsChange}
                onMangaMetaChange={handleMangaMetaChange}
                onThoughtsSpoilerChange={handleThoughtsSpoilerChange}
                onRemoveBook={handleRemoveBook}
                viewMode={viewMode}
            />
            <section className="home-activity-card mt-3" aria-label="Reading activity feed">
                <div className="home-activity-head">
                    <div>
                        <h5 className="mb-1">Reading Activity</h5>
                        <p className="mb-0">Recent updates from your shelf.</p>
                    </div>
                    <button
                        type="button"
                        className="btn btn-outline-primary btn-sm home-activity-toggle"
                        onClick={() => setIsActivityExpanded((current) => !current)}
                        aria-expanded={isActivityExpanded}
                        aria-controls="home-activity-panel"
                    >
                        {isActivityExpanded ? 'Collapse' : 'Expand'}
                    </button>
                </div>
                {!isActivityExpanded ? (
                    <p className="home-activity-collapsed-note mb-0">Activity is collapsed.</p>
                ) : readingActivity.length === 0 ? (
                    <p id="home-activity-panel" className="home-activity-empty mb-0">No activity yet. Add or update a book to see it here.</p>
                ) : (
                    <div id="home-activity-panel" className="home-activity-list">
                        {readingActivity.map((entry) => (
                            <article key={entry.id} className="home-activity-item">
                                <img
                                    src={entry.cover || `https://via.placeholder.com/60x84?text=${encodeURIComponent(entry.title || 'Book')}`}
                                    alt={entry.title}
                                    className="home-activity-cover"
                                />
                                <div className="home-activity-body">
                                    <p className="home-activity-main mb-1">
                                        <strong>{entry.title}</strong> {entry.action}
                                    </p>
                                    <p className="home-activity-meta mb-0">
                                        <time>{formatActivityTimestamp(entry.timestamp)}</time>
                                        {entry.isManga && entry.progress && <span aria-hidden="true"> • {entry.progress}</span>}
                                        {entry.hasSpoilerThoughts && <span className="spoiler-pill ms-2">Spoiler Thoughts</span>}
                                    </p>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </section>
            {pendingRemoveBook && (
                <div
                    className="modal show d-block themed-confirm-backdrop"
                    tabIndex="-1"
                    role="dialog"
                    aria-modal="true"
                    onClick={cancelRemoveBook}
                >
                    <div
                        className="modal-dialog modal-dialog-centered themed-confirm-dialog"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="modal-content glass-container themed-confirm-content">
                            <div className="modal-header">
                                <h5 className="modal-title mb-0">Remove Book</h5>
                                <button
                                    type="button"
                                    className="btn-close"
                                    aria-label="Close remove confirmation"
                                    onClick={cancelRemoveBook}
                                />
                            </div>
                            <div className="modal-body">
                                <p className="mb-2">
                                    Remove <strong>{pendingRemoveBook.title}</strong> from your library?
                                </p>
                                <p className="themed-confirm-note mb-0">
                                    This removes it from your shelf and synced account library.
                                </p>
                            </div>
                            <div className="modal-footer themed-confirm-actions">
                                <button
                                    type="button"
                                    className="btn btn-outline-secondary"
                                    onClick={cancelRemoveBook}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-outline-danger"
                                    onClick={confirmRemoveBook}
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Home;
