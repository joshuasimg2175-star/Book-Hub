import React from 'react';

const Book = ({
  book,
  onStatusChange,
  onThoughtsChange,
  onRemoveBook,
  onMangaMetaChange,
  onThoughtsSpoilerChange
}) => {
  const normalizeStatus = (status) => {
    const value = String(status || '').trim().toLowerCase();
    if (value === 'did not finish' || value === 'did-not-finish' || value === 'dnf') return 'unread';
    return value;
  };
  const isManga = String(book?.mediaType || '').trim().toLowerCase() === 'manga';

  const statuses = [
    { value: 'read', label: 'Finished' },
    { value: 'currently reading', label: 'Currently Reading' },
    { value: 'wishlist', label: 'Wishlist' },
    { value: 'unread', label: "Didn't Finish" }
  ];
  const arcTagsValue = Array.isArray(book?.arcTags) ? book.arcTags.join(', ') : String(book?.arcTags || '');

  return (
    <div className="glass-container mb-3 book-item-card">
      <div className="row g-0 book-item-row">
        <div className="col-4 col-sm-3 col-md-2 book-item-cover-col">
          <img
            src={book.cover || `https://via.placeholder.com/150x200?text=${encodeURIComponent(book.title || 'Book')}`}
            className="img-fluid rounded-start book-item-cover"
            alt={book.title}
          />
        </div>
        <div className="col-8 col-sm-9 col-md-10 book-item-body">
          <div className="d-flex align-items-center justify-content-between gap-2">
            <h5 className="card-title mb-1">{book.title}</h5>
            {isManga && <span className="book-media-badge">Manga</span>}
          </div>
          <p className="card-text"><small>{book.authors?.join(', ')}</small></p>
          <p className="card-text">{book.summary}</p>
          {isManga && (
            <div className="manga-progress-editor mb-3">
              <div className="manga-progress-grid">
                <div>
                  <label className="form-label mb-1" htmlFor={`manga-volume-${book.id}`}>Volume</label>
                  <input
                    id={`manga-volume-${book.id}`}
                    type="number"
                    min="0"
                    step="0.1"
                    className="form-control"
                    value={book.mangaVolume ?? ''}
                    onChange={(event) => {
                      if (typeof onMangaMetaChange === 'function') {
                        onMangaMetaChange(book.id, { mangaVolume: event.target.value });
                      }
                    }}
                  />
                </div>
                <div>
                  <label className="form-label mb-1" htmlFor={`manga-chapter-${book.id}`}>Chapter</label>
                  <input
                    id={`manga-chapter-${book.id}`}
                    type="number"
                    min="0"
                    step="0.1"
                    className="form-control"
                    value={book.mangaChapter ?? ''}
                    onChange={(event) => {
                      if (typeof onMangaMetaChange === 'function') {
                        onMangaMetaChange(book.id, { mangaChapter: event.target.value });
                      }
                    }}
                  />
                </div>
              </div>
              <div className="mt-2">
                <label className="form-label mb-1" htmlFor={`manga-arc-tags-${book.id}`}>Arc Tags</label>
                <input
                  id={`manga-arc-tags-${book.id}`}
                  type="text"
                  className="form-control"
                  placeholder="Comma separated arcs"
                  value={arcTagsValue}
                  onChange={(event) => {
                    if (typeof onMangaMetaChange === 'function') {
                      onMangaMetaChange(book.id, { arcTags: event.target.value });
                    }
                  }}
                />
              </div>
            </div>
          )}
          <div className="mb-3">
            <div className="book-status-group" role="group" aria-label={`Update status for ${book.title}`}>
              {statuses.map(status => (
                <button
                  key={status.value}
                  type="button"
                  className={`btn btn-sm ${normalizeStatus(book.status) === status.value ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => onStatusChange(book.id, status.value)}
                >
                  {status.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            className="form-control"
            placeholder="My thoughts..."
            value={book.thoughts || ''}
            onChange={(e) => onThoughtsChange(book.id, e.target.value)}
          ></textarea>
          <div className="form-check spoiler-toggle mt-2">
            <input
              id={`book-spoiler-toggle-${book.id}`}
              type="checkbox"
              className="form-check-input"
              checked={Boolean(book.thoughtsContainSpoilers)}
              onChange={(event) => {
                if (typeof onThoughtsSpoilerChange === 'function') {
                  onThoughtsSpoilerChange(book.id, event.target.checked);
                }
              }}
            />
            <label className="form-check-label" htmlFor={`book-spoiler-toggle-${book.id}`}>
              Thoughts contain spoilers
            </label>
          </div>
          <div className="book-card-footer-actions mt-2">
            <button
              type="button"
              className="btn btn-sm btn-outline-danger"
              onClick={() => {
                if (typeof onRemoveBook === 'function') onRemoveBook(book.id);
              }}
            >
              Remove Book
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Book;
