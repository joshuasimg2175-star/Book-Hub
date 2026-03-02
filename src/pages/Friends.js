import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    addFriend,
    getFriendBooks,
    getFriendRequests,
    getFriends,
    removeFriend,
    respondToFriendRequest
} from '../services/backend';
import { addBook } from '../utils/bookStorage';
import { getCurrentUser } from '../utils/authStorage';

const STATUS_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'currently reading', label: 'Currently Reading' },
    { value: 'read', label: 'Finished' },
    { value: 'unread', label: "Didn't Finish" },
    { value: 'wishlist', label: 'Wishlist' }
];

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

const isMangaBook = (book) => String(book?.mediaType || '').trim().toLowerCase() === 'manga';

const mangaProgressLabel = (book) => {
    if (!isMangaBook(book)) return '';
    const volume = String(book?.mangaVolume ?? '').trim();
    const chapter = String(book?.mangaChapter ?? '').trim();
    const parts = [];
    if (volume) parts.push(`Vol ${volume}`);
    if (chapter) parts.push(`Ch ${chapter}`);
    return parts.length > 0 ? parts.join(' • ') : 'Not tracked yet';
};

const mangaArcTagsLabel = (book) => {
    const tags = Array.isArray(book?.arcTags)
        ? book.arcTags
        : String(book?.arcTags || '').split(',');
    const normalized = tags.map((tag) => String(tag || '').trim()).filter(Boolean);
    return normalized.join(', ');
};

const friendHandle = (friend) => {
    const username = String(friend?.username || '').trim();
    if (username) return `@${username}`;
    return String(friend?.name || 'Reader');
};

const Friends = () => {
    const currentUserId = getCurrentUser()?.id || 1;
    const [friends, setFriends] = useState([]);
    const [booksByFriend, setBooksByFriend] = useState({});
    const [timelineBooks, setTimelineBooks] = useState([]);
    const [incomingRequests, setIncomingRequests] = useState([]);
    const [outgoingRequests, setOutgoingRequests] = useState([]);
    const [activePanel, setActivePanel] = useState('friend');
    const [selectedFriendId, setSelectedFriendId] = useState(null);
    const [timelineFriendFilter, setTimelineFriendFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedBook, setSelectedBook] = useState(null);
    const [selectedBookFriend, setSelectedBookFriend] = useState(null);
    const [showSpoilerThoughts, setShowSpoilerThoughts] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isAddingFriend, setIsAddingFriend] = useState(false);
    const [newFriendName, setNewFriendName] = useState('');
    const [requestBusyKey, setRequestBusyKey] = useState('');
    const [removingFriendId, setRemovingFriendId] = useState('');
    const [loadError, setLoadError] = useState('');
    const [notice, setNotice] = useState(null);

    const loadFriendsData = useCallback(async ({ refresh = false } = {}) => {
        setLoadError('');
        if (refresh) {
            setIsRefreshing(true);
        } else {
            setIsLoading(true);
        }

        try {
            const [myFriends, friendRequestPayload] = await Promise.all([
                getFriends(currentUserId),
                getFriendRequests(currentUserId)
            ]);
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

            const byFriend = {};
            friendPayloads.forEach(({ friend, books }) => {
                byFriend[friend.id] = [...books].sort((a, b) => b.timelineTs - a.timelineTs);
            });

            const mergedTimeline = friendPayloads
                .flatMap(({ books }) => books)
                .sort((a, b) => b.timelineTs - a.timelineTs);

            setFriends(myFriends);
            setBooksByFriend(byFriend);
            setTimelineBooks(mergedTimeline);
            setIncomingRequests(Array.isArray(friendRequestPayload?.incoming) ? friendRequestPayload.incoming : []);
            setOutgoingRequests(Array.isArray(friendRequestPayload?.outgoing) ? friendRequestPayload.outgoing : []);

            setSelectedFriendId((existing) => {
                if (existing && byFriend[existing]) return existing;
                return myFriends[0]?.id ?? null;
            });

            if (refresh) {
                setNotice({ type: 'success', message: 'Friends list refreshed.' });
            }
        } catch {
            setLoadError('Could not load friends data right now. Please try again.');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [currentUserId]);

    useEffect(() => {
        void loadFriendsData();
    }, [loadFriendsData]);

    useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(null), 2600);
        return () => clearTimeout(timer);
    }, [notice]);

    useEffect(() => {
        if (!selectedBook) return undefined;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [selectedBook]);

    const selectedFriend = useMemo(
        () => friends.find((friend) => friend.id === selectedFriendId) || null,
        [friends, selectedFriendId]
    );

    const selectedFriendBooks = useMemo(
        () => (selectedFriendId ? booksByFriend[selectedFriendId] || [] : []),
        [booksByFriend, selectedFriendId]
    );

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

    const closeModal = () => {
        setSelectedBook(null);
        setSelectedBookFriend(null);
        setShowSpoilerThoughts(false);
    };

    const openBookModal = (book) => {
        setSelectedBook(book);
        setSelectedBookFriend(book.friendName || friendHandle(selectedFriend) || 'Friend');
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

    const openFriendPanel = (friendId) => {
        setSelectedFriendId(friendId);
        setActivePanel('friend');
    };

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
                                <p><strong>Status:</strong> {statusLabel(selectedBook.status)}</p>
                                {isMangaBook(selectedBook) && (
                                    <>
                                        <p><strong>Manga Progress:</strong> {mangaProgressLabel(selectedBook)}</p>
                                        {mangaArcTagsLabel(selectedBook) && <p><strong>Arc Tags:</strong> {mangaArcTagsLabel(selectedBook)}</p>}
                                    </>
                                )}
                                <div className="mt-3">
                                    <strong>Summary:</strong>
                                    <p className="mt-2">{selectedBook.summary || selectedBook.description || 'No summary available.'}</p>
                                </div>
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

    const handleRequestAction = async (requestId, action, fromUser) => {
        const key = `${requestId}:${action}`;
        if (requestBusyKey) return;

        setRequestBusyKey(key);
        setLoadError('');

        try {
            await respondToFriendRequest(requestId, action);
            await loadFriendsData();

            if (action === 'accept') {
                if (fromUser?.id) {
                    setSelectedFriendId(fromUser.id);
                    setActivePanel('friend');
                }
                setNotice({ type: 'success', message: `Friend request accepted from ${friendHandle(fromUser)}.` });
            } else {
                setNotice({ type: 'success', message: `Friend request declined from ${friendHandle(fromUser)}.` });
            }
        } catch (error) {
            setNotice({ type: 'error', message: error?.message || 'Could not update this request right now.' });
        } finally {
            setRequestBusyKey('');
        }
    };

    const handleRemoveFriendById = async (friend) => {
        if (!friend?.id) return;
        if (removingFriendId) return;

        const friendName = friendHandle(friend);

        setRemovingFriendId(friend.id);
        setLoadError('');

        try {
            await removeFriend(friend.id, currentUserId);
            await loadFriendsData();
            setActivePanel('friend');
            setNotice({ type: 'success', message: `${friendName} was removed from your friends list.` });
        } catch (error) {
            setNotice({ type: 'error', message: error?.message || 'Could not remove this friend right now.' });
        } finally {
            setRemovingFriendId('');
        }
    };

    const handleRemoveSelectedFriend = async () => {
        if (!selectedFriend) return;
        await handleRemoveFriendById(selectedFriend);
    };

    const handleAddFriend = async (event) => {
        event.preventDefault();
        if (isAddingFriend) return;

        const friendUsername = String(newFriendName || '').trim().toLowerCase().replace(/^@+/, '');
        if (!/^[a-z0-9]{3,24}$/.test(friendUsername)) {
            setNotice({ type: 'error', message: 'Enter a valid username (3-24 letters or numbers).' });
            return;
        }

        setIsAddingFriend(true);
        setLoadError('');

        try {
            const result = await addFriend(currentUserId, friendUsername);
            const friendLabel = result.friend ? friendHandle(result.friend) : `@${friendUsername}`;
            setNewFriendName('');
            await loadFriendsData();
            setTimelineFriendFilter('all');

            if (result.alreadyFriend) {
                if (result.friend?.id) {
                    setSelectedFriendId(result.friend.id);
                    setActivePanel('friend');
                }
                setNotice({ type: 'success', message: `${friendLabel} is already in your friends list.` });
            } else if (result.accepted) {
                if (result.friend?.id) {
                    setSelectedFriendId(result.friend.id);
                    setActivePanel('friend');
                }
                setNotice({ type: 'success', message: `${friendLabel} accepted your connection and is now a friend.` });
            } else if (result.requestPending) {
                setActivePanel('friend');
                setNotice({
                    type: 'success',
                    message: result.direction === 'outgoing'
                        ? `Friend request sent to ${friendLabel}.`
                        : 'Friend request is pending.'
                });
            } else if (result.created) {
                setNotice({ type: 'success', message: `${friendLabel} was created and added as a friend.` });
            } else {
                if (result.friend?.id) {
                    setSelectedFriendId(result.friend.id);
                    setActivePanel('friend');
                }
                setNotice({ type: 'success', message: `${friendLabel} was added to your friends list.` });
            }
        } catch (error) {
            setNotice({ type: 'error', message: error?.message || 'Could not add this friend right now.' });
        } finally {
            setIsAddingFriend(false);
        }
    };

    return (
        <div className="glass-container friends-shell">
            <div className="friends-header-row friends-hero">
                <div className="friends-hero-main">
                    <div className="friends-kicker">BookHub Social</div>
                    <h2 className="mb-1">Friends</h2>
                    <p className="friends-subtitle mb-0">Follow what friends are reading and save books to your wishlist.</p>
                    <div className="friends-stat-strip">
                        <div className="friends-stat-pill">
                            <span>Friends</span>
                            <strong>{friends.length}</strong>
                        </div>
                        <div className="friends-stat-pill">
                            <span>Incoming</span>
                            <strong>{incomingRequests.length}</strong>
                        </div>
                        <div className="friends-stat-pill">
                            <span>Outgoing</span>
                            <strong>{outgoingRequests.length}</strong>
                        </div>
                    </div>
                </div>
                <div className="friends-header-actions friends-hero-actions">
                    <form className="friends-add-form" onSubmit={handleAddFriend}>
                        <label htmlFor="friend-name-input" className="visually-hidden">
                            Add friend
                        </label>
                        <div className="friends-add-row">
                            <input
                                id="friend-name-input"
                                type="text"
                                className="form-control"
                                placeholder="Add friend by username"
                                value={newFriendName}
                                onChange={(event) => setNewFriendName(event.target.value)}
                                autoComplete="off"
                            />
                            <button type="submit" className="btn btn-primary" disabled={isAddingFriend || isLoading}>
                                {isAddingFriend ? 'Adding...' : 'Add Friend'}
                            </button>
                        </div>
                    </form>
                    <button
                        type="button"
                        className="btn btn-outline-secondary"
                        disabled={isLoading || isRefreshing || isAddingFriend}
                        onClick={() => void loadFriendsData({ refresh: true })}
                    >
                        {isRefreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </div>

            <div className="friends-social-grid">
                <section className="friends-directory-card">
                    <div className="friend-requests-card-header">
                        <h4 className="mb-0">My Friends</h4>
                        <span className="friend-requests-count">{friends.length}</span>
                    </div>
                    {isLoading ? (
                        <p className="friend-requests-empty mb-0">Loading friends...</p>
                    ) : friends.length === 0 ? (
                        <p className="friend-requests-empty mb-0">Add someone to start your friends shelf.</p>
                    ) : (
                        <div className="friend-request-list">
                            {friends.map((friend) => (
                                <article key={friend.id} className="friend-request-item">
                                    <div className="friend-request-main">
                                        <h6 className="mb-1">{friendHandle(friend)}</h6>
                                        <p className="mb-0">{friend.name || 'BookHub friend'}</p>
                                    </div>
                                    <div className="friend-request-actions">
                                        <button
                                            type="button"
                                            className="btn btn-outline-primary btn-sm"
                                            onClick={() => openFriendPanel(friend.id)}
                                        >
                                            Open Shelf
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-outline-danger btn-sm"
                                            disabled={Boolean(removingFriendId)}
                                            onClick={() => {
                                                void handleRemoveFriendById(friend);
                                            }}
                                        >
                                            {removingFriendId === friend.id ? 'Removing...' : 'Remove'}
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </section>

                <section className="friend-requests-card">
                    <div className="friend-requests-card-header">
                        <h4 className="mb-0">Incoming Requests</h4>
                        <span className="friend-requests-count">{incomingRequests.length}</span>
                    </div>
                    {incomingRequests.length === 0 ? (
                        <p className="friend-requests-empty mb-0">No incoming requests right now.</p>
                    ) : (
                        <div className="friend-request-list">
                            {incomingRequests.map((request) => {
                                const acceptKey = `${request.id}:accept`;
                                const declineKey = `${request.id}:decline`;
                                return (
                                    <article key={request.id} className="friend-request-item">
                                        <div className="friend-request-main">
                                            <h6 className="mb-1">{friendHandle(request.fromUser)}</h6>
                                            <p className="mb-0">
                                                {request.fromUser?.name || 'BookHub Reader'}
                                                <span aria-hidden="true"> • </span>
                                                <time title={formatLongDate(request.createdAt)}>{formatTimelineDate(request.createdAt)}</time>
                                            </p>
                                        </div>
                                        <div className="friend-request-actions">
                                            <button
                                                type="button"
                                                className="btn btn-primary btn-sm"
                                                disabled={Boolean(requestBusyKey)}
                                                onClick={() => handleRequestAction(request.id, 'accept', request.fromUser)}
                                            >
                                                {requestBusyKey === acceptKey ? 'Accepting...' : 'Accept'}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-outline-secondary btn-sm"
                                                disabled={Boolean(requestBusyKey)}
                                                onClick={() => handleRequestAction(request.id, 'decline', request.fromUser)}
                                            >
                                                {requestBusyKey === declineKey ? 'Declining...' : 'Decline'}
                                            </button>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </section>

                <section className="friend-requests-card">
                    <div className="friend-requests-card-header">
                        <h4 className="mb-0">Outgoing Requests</h4>
                        <span className="friend-requests-count">{outgoingRequests.length}</span>
                    </div>
                    {outgoingRequests.length === 0 ? (
                        <p className="friend-requests-empty mb-0">No outgoing requests pending.</p>
                    ) : (
                        <div className="friend-request-list">
                            {outgoingRequests.map((request) => (
                                <article key={request.id} className="friend-request-item outgoing">
                                    <div className="friend-request-main">
                                        <h6 className="mb-1">{friendHandle(request.toUser)}</h6>
                                        <p className="mb-0">
                                            {request.toUser?.name || 'BookHub Reader'}
                                            <span aria-hidden="true"> • </span>
                                            <time title={formatLongDate(request.createdAt)}>{formatTimelineDate(request.createdAt)}</time>
                                        </p>
                                    </div>
                                    <span className="status-pill tone-default">Pending</span>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
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

            <div className="friends-content-card">
                {isLoading ? (
                    <div className="timeline-empty">Loading friend activity...</div>
                ) : (
                    <>
                        {activePanel === 'timeline' ? (
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
                                    placeholder="Search by title, author, friend, or thoughts..."
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

                                {filteredTimelineBooks.length === 0 ? (
                                    <div className="timeline-empty">No books match your current filters.</div>
                                ) : (
                                    <div className="timeline-feed-wrap">
                                        <div className="timeline-feed">
                                            {filteredTimelineBooks.map((book) => (
                                                <article key={`${book.friendId}-${book.id}-${book.timelineTs}`} className="timeline-event">
                                                    <span className={`timeline-event-dot ${statusToneClass(book.status)}`} />
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
                                                </article>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                            <div className="friends-chip-row">
                                {friends.map((friend) => (
                                    <button
                                        key={friend.id}
                                        type="button"
                                        className={`friends-chip ${selectedFriendId === friend.id ? 'active' : ''}`}
                                        onClick={() => setSelectedFriendId(friend.id)}
                                    >
                                        {friendHandle(friend)}
                                    </button>
                                ))}
                            </div>

                            {selectedFriend ? (
                                <>
                                    <div className="friend-shelf-header">
                                        <div className="friend-shelf-header-main">
                                            <h3 className="mb-1">{friendHandle(selectedFriend)}'s Shelf</h3>
                                            <p className="mb-0">Tap a book to see details or save it to your wishlist.</p>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-outline-danger btn-sm friend-remove-btn"
                                            onClick={() => {
                                                void handleRemoveSelectedFriend();
                                            }}
                                            disabled={Boolean(removingFriendId)}
                                        >
                                            {removingFriendId === selectedFriend.id ? 'Removing...' : 'Remove Friend'}
                                        </button>
                                    </div>
                                    {selectedFriendBooks.length === 0 ? (
                                        <div className="timeline-empty">{friendHandle(selectedFriend)} has not added any books yet.</div>
                                    ) : (
                                        <div className="friend-books-grid">
                                            {selectedFriendBooks.map((book) => (
                                                <article key={`${book.friendId}-${book.id}`} className="friend-book-card">
                                                    <img
                                                        src={book.cover || `https://via.placeholder.com/150x200?text=${encodeURIComponent(book.title)}`}
                                                        className="friend-book-cover"
                                                        alt={book.title}
                                                        onClick={() => openBookModal(book)}
                                                    />
                                                    <div className="friend-book-body">
                                                        <h6 className="mb-1 friend-book-title" onClick={() => openBookModal(book)}>
                                                            {book.title}
                                                        </h6>
                                                        <p className="friend-book-authors mb-2">{book.authors?.join(', ') || 'Unknown Author'}</p>
                                                        <span className={`status-pill ${statusToneClass(book.status)}`}>
                                                            {statusLabel(book.status)}
                                                        </span>
                                                        {isMangaBook(book) && (
                                                            <p className="friend-book-copy mb-2">{mangaProgressLabel(book)}</p>
                                                        )}
                                                        {isMangaBook(book) && mangaArcTagsLabel(book) && (
                                                            <p className="friend-book-copy mb-2">{mangaArcTagsLabel(book)}</p>
                                                        )}
                                                        {hasSpoilerThoughts(book) && <p className="friend-book-copy mb-2"><span className="spoiler-pill">Spoiler</span></p>}
                                                        <p className="friend-book-copy mb-2">{excerptText(book)}</p>
                                                        <button type="button" className="btn btn-primary btn-sm" onClick={() => addToWishlist(book)}>
                                                            Add to Wishlist
                                                        </button>
                                                    </div>
                                                </article>
                                            ))}
                                        </div>
                                    )}
                                    </>
                                ) : (
                                    <div className="timeline-empty">Select a friend to view their shelf.</div>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>

            {detailsModal && typeof document !== 'undefined' ? createPortal(detailsModal, document.body) : null}
        </div>
    );
};

export default Friends;
