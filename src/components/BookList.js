import React, { useState } from 'react';
import Book from './Book';

const BookList = ({
  books,
  onStatusChange,
  onThoughtsChange,
  onRemoveBook,
  onMangaMetaChange,
  onThoughtsSpoilerChange,
  viewMode
}) => {
  const [selectedBook, setSelectedBook] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const normalizeStatus = (status) => {
    const value = String(status || '').trim().toLowerCase();
    if (value === 'did not finish' || value === 'did-not-finish' || value === 'dnf') return 'unread';
    return value;
  };

  const handleBookClick = (book) => {
    setSelectedBook(book);
    setShowModal(true);
  };

  const handleStatusChangeInModal = (bookId, newStatus) => {
    onStatusChange(bookId, newStatus);
    setSelectedBook(prev => prev ? { ...prev, status: newStatus } : null);
  };

  const handleThoughtsChangeInModal = (bookId, newThoughts) => {
    onThoughtsChange(bookId, newThoughts);
    setSelectedBook(prev => prev ? { ...prev, thoughts: newThoughts } : null);
  };

  const handleThoughtsSpoilerChangeInModal = (bookId, containsSpoilers) => {
    if (typeof onThoughtsSpoilerChange === 'function') {
      onThoughtsSpoilerChange(bookId, containsSpoilers);
    }
    setSelectedBook(prev => prev ? { ...prev, thoughtsContainSpoilers: containsSpoilers } : null);
  };

  const handleMangaMetaChangeInModal = (bookId, updates) => {
    if (typeof onMangaMetaChange === 'function') {
      onMangaMetaChange(bookId, updates);
    }
    setSelectedBook(prev => prev ? { ...prev, ...updates } : null);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedBook(null);
  };

  const handleRemove = (bookId, { close = false } = {}) => {
    if (typeof onRemoveBook !== 'function') return;
    onRemoveBook(bookId);
    if (close) closeModal();
  };

  const statuses = [
    { value: 'read', label: 'Finished' },
    { value: 'currently reading', label: 'Currently Reading' },
    { value: 'wishlist', label: 'Wishlist' },
    { value: 'unread', label: "Didn't Finish" }
  ];

  const isManga = (book) => String(book?.mediaType || '').trim().toLowerCase() === 'manga';
  const arcTagsText = (book) => (Array.isArray(book?.arcTags) ? book.arcTags.join(', ') : String(book?.arcTags || '').trim());
  const mangaProgressText = (book) => {
    if (!isManga(book)) return '';
    const volume = String(book?.mangaVolume ?? '').trim();
    const chapter = String(book?.mangaChapter ?? '').trim();
    const parts = [];
    if (volume) parts.push(`Vol ${volume}`);
    if (chapter) parts.push(`Ch ${chapter}`);
    return parts.join(' • ');
  };

  if (viewMode === 'grid') {
    return (
      <>
        <div className="row book-grid-row g-3">
          {books.map(book => (
            <div key={book.id} className="col-lg-4 col-md-6 col-6">
              <div className="glass-container text-center book-grid-card">
                <img
                  src={book.cover}
                  className="img-fluid mb-2 book-grid-cover"
                  alt={book.title}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleBookClick(book)}
                />
                <div className="d-flex align-items-center justify-content-center gap-2">
                  <h6 className="book-grid-title mb-0">{book.title}</h6>
                  {isManga(book) && (
                    <span className="book-media-badge">Manga</span>
                  )}
                </div>
                <p className="book-grid-authors"><small>{book.authors?.join(', ')}</small></p>
                {isManga(book) && (
                  <>
                    {mangaProgressText(book) && <p className="book-grid-manga-meta mb-1">{mangaProgressText(book)}</p>}
                    {arcTagsText(book) && <p className="book-grid-manga-meta mb-0">{arcTagsText(book)}</p>}
                  </>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger w-100 mt-2"
                  onClick={() => handleRemove(book.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        {showModal && selectedBook && (
          <div className="modal show d-block book-details-modal" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-lg book-details-dialog">
              <div className="modal-content glass-container">
                <div className="modal-header">
                  <div className="d-flex align-items-center gap-2">
                    <h5 className="modal-title mb-0">{selectedBook.title}</h5>
                    {isManga(selectedBook) && (
                      <span className="book-media-badge">Manga</span>
                    )}
                  </div>
                  <button type="button" className="btn-close" onClick={closeModal}></button>
                </div>
                <div className="modal-body">
                  <div className="row">
                    <div className="col-md-4">
                      <img src={selectedBook.cover} className="img-fluid" alt={selectedBook.title} />
                    </div>
                    <div className="col-md-8">
                      <p><strong>Authors:</strong> {selectedBook.authors?.join(', ')}</p>
                      <p><strong>Description:</strong> {selectedBook.summary}</p>
                      {isManga(selectedBook) && (
                        <div className="manga-progress-editor modal-manga-editor mb-3">
                          <div className="manga-progress-grid">
                            <div>
                              <label className="form-label mb-1" htmlFor="modalMangaVolume">Volume</label>
                              <input
                                id="modalMangaVolume"
                                type="number"
                                min="0"
                                step="0.1"
                                className="form-control"
                                value={selectedBook.mangaVolume ?? ''}
                                onChange={(event) => handleMangaMetaChangeInModal(selectedBook.id, { mangaVolume: event.target.value })}
                              />
                            </div>
                            <div>
                              <label className="form-label mb-1" htmlFor="modalMangaChapter">Chapter</label>
                              <input
                                id="modalMangaChapter"
                                type="number"
                                min="0"
                                step="0.1"
                                className="form-control"
                                value={selectedBook.mangaChapter ?? ''}
                                onChange={(event) => handleMangaMetaChangeInModal(selectedBook.id, { mangaChapter: event.target.value })}
                              />
                            </div>
                          </div>
                          <div className="mt-2">
                            <label className="form-label mb-1" htmlFor="modalMangaArcTags">Arc Tags</label>
                            <input
                              id="modalMangaArcTags"
                              type="text"
                              className="form-control"
                              placeholder="Comma separated arcs"
                              value={arcTagsText(selectedBook)}
                              onChange={(event) => handleMangaMetaChangeInModal(selectedBook.id, { arcTags: event.target.value })}
                            />
                          </div>
                        </div>
                      )}
                      <div className="mb-3">
                        <strong>Status:</strong>
                        <div className="btn-group ms-2" role="group">
                          {statuses.map(status => (
                            <button
                              key={status.value}
                              type="button"
                              className={`btn btn-sm ${normalizeStatus(selectedBook.status) === status.value ? 'btn-primary' : 'btn-outline-primary'}`}
                              onClick={() => handleStatusChangeInModal(selectedBook.id, status.value)}
                            >
                              {status.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <strong>My Thoughts:</strong>
                        <textarea
                          className="form-control mt-2"
                          placeholder="My thoughts..."
                          value={selectedBook.thoughts || ''}
                          onChange={(e) => handleThoughtsChangeInModal(selectedBook.id, e.target.value)}
                        ></textarea>
                        <div className="form-check spoiler-toggle mt-2">
                          <input
                            id="modalThoughtsSpoiler"
                            type="checkbox"
                            className="form-check-input"
                            checked={Boolean(selectedBook.thoughtsContainSpoilers)}
                            onChange={(event) => handleThoughtsSpoilerChangeInModal(selectedBook.id, event.target.checked)}
                          />
                          <label className="form-check-label" htmlFor="modalThoughtsSpoiler">
                            Thoughts contain spoilers
                          </label>
                        </div>
                      </div>
                      <div className="mt-3 d-flex justify-content-end">
                        <button
                          type="button"
                          className="btn btn-outline-danger"
                          onClick={() => handleRemove(selectedBook.id, { close: true })}
                        >
                          Remove Book
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div>
      {books.map(book => (
        <Book
          key={book.id}
          book={book}
          onStatusChange={onStatusChange}
          onThoughtsChange={onThoughtsChange}
          onRemoveBook={onRemoveBook}
          onMangaMetaChange={onMangaMetaChange}
          onThoughtsSpoilerChange={onThoughtsSpoilerChange}
        />
      ))}
    </div>
  );
};

export default BookList;
