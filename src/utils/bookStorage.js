import { apiRequest, canUseBackend } from '../services/apiClient';
import { AUTH_SESSION_TOKEN_KEY } from './authKeys';

const STORAGE_KEY = 'bookHubBooks';

const readLocalBooks = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeLocalBooks = (books) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(books) ? books : []));
};

const getSessionToken = () => {
  try {
    return localStorage.getItem(AUTH_SESSION_TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

const hasServerSession = () => {
  const token = getSessionToken();
  return Boolean(token && !token.startsWith('local-'));
};

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

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
    : String(value || '')
      .split(',');
  return [...new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))];
};

const sanitizeBook = (book = {}) => {
  const mediaType = String(book.mediaType || '').trim().toLowerCase() === 'manga' ? 'manga' : 'book';
  const addedAt = String(book.addedAt || '').trim() || new Date().toISOString();
  const updatedAt = String(book.updatedAt || '').trim() || addedAt;
  return {
    id: String(book.id || Date.now()),
    title: String(book.title || 'Unknown Title'),
    authors: Array.isArray(book.authors) ? book.authors.filter(Boolean) : [book.authors || 'Unknown Author'],
    cover: String(book.cover || 'https://via.placeholder.com/150x200'),
    summary: String(book.summary || ''),
    description: String(book.description || book.summary || ''),
    status: String(book.status || 'unread'),
    thoughts: String(book.thoughts || ''),
    thoughtsContainSpoilers: normalizeBoolean(
      book.thoughtsContainSpoilers ?? book.hasSpoilerThoughts ?? book.spoilerThoughts
    ),
    mediaType,
    seriesType: String(book.seriesType || ''),
    mangaVolume: mediaType === 'manga' ? normalizeMangaProgress(book.mangaVolume ?? book.volume) : '',
    mangaChapter: mediaType === 'manga' ? normalizeMangaProgress(book.mangaChapter ?? book.chapter) : '',
    arcTags: mediaType === 'manga' ? normalizeArcTags(book.arcTags ?? book.arcs) : [],
    source: String(book.source || ''),
    addedAt,
    updatedAt
  };
};

const normalizeForDuplicateCheck = (book) => {
  const title = String(book?.title || '').trim().toLowerCase();
  const authors = (Array.isArray(book?.authors) ? book.authors : [book?.authors || ''])
    .map((author) => String(author || '').trim().toLowerCase())
    .sort()
    .join('|');
  return `${title}|${authors}`;
};

const pushBooksToServer = async (books) => {
  if (!canUseBackend() || !hasServerSession()) return;
  await apiRequest({
    method: 'PUT',
    path: '/api/books',
    data: { books }
  });
};

export const getBooks = () => readLocalBooks();

export const syncBooksFromServer = async () => {
  if (!canUseBackend() || !hasServerSession()) return readLocalBooks();

  try {
    const response = await apiRequest({
      method: 'GET',
      path: '/api/books'
    });
    const remoteBooks = Array.isArray(response.data?.books) ? response.data.books.map(sanitizeBook) : [];
    writeLocalBooks(remoteBooks);
    return remoteBooks;
  } catch {
    return readLocalBooks();
  }
};

export const saveBooks = async (books) => {
  const normalizedBooks = (Array.isArray(books) ? books : []).map((book) => sanitizeBook(book));
  writeLocalBooks(normalizedBooks);

  try {
    await pushBooksToServer(normalizedBooks);
  } catch {
    // Local save succeeds even when server sync fails.
  }
};

export const addBook = (book) => {
  try {
    const books = readLocalBooks();
    const normalizedKey = normalizeForDuplicateCheck(book);

    const duplicateIndex = books.findIndex((existingBook) => normalizeForDuplicateCheck(existingBook) === normalizedKey);
    const newBook = sanitizeBook(book);

    if (duplicateIndex >= 0) {
      books[duplicateIndex] = {
        ...books[duplicateIndex],
        ...newBook,
        id: books[duplicateIndex].id
      };
    } else {
      books.push(newBook);
    }

    writeLocalBooks(books);

    // Sync remote copy in background when backend is available.
    void pushBooksToServer(books);

    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('booksUpdated', { detail: { newBook } }));
    }, 0);
    return newBook;
  } catch {
    return null;
  }
};
