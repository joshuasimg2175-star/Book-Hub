import axios from 'axios';

const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const GOOGLE_BOOKS_BASE_URL = 'https://www.googleapis.com/books/v1/volumes';
const JIKAN_MANGA_BASE_URL = 'https://api.jikan.moe/v4/manga';
const REQUEST_TIMEOUT_MS = 12000;
const FALLBACK_COVER = 'https://via.placeholder.com/180x280?text=No+Cover';
const SUMMARY_FALLBACK = 'No summary available.';
const MAX_SUMMARY_LENGTH = 170;
const MIN_SUMMARY_LENGTH = 70;
const MAX_SUMMARY_SENTENCES = 2;

const normalizeBookCode = (value = '') => value.toUpperCase().replace(/[^0-9X]/g, '');
const toHttps = (url = '') => url.replace(/^http:\/\//i, 'https://');

const extractDescription = (description) => {
  if (!description) return '';
  if (typeof description === 'string') return description;
  if (typeof description?.value === 'string') return description.value;
  if (Array.isArray(description)) {
    const firstString = description.find((entry) => typeof entry === 'string');
    if (firstString) return firstString;
  }
  return '';
};

const uniqueNonEmpty = (values) => [...new Set(values.filter(Boolean))];

const decodeBasicHtmlEntities = (value = '') =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

const normalizeSummaryText = (rawSummary = '') =>
  decodeBasicHtmlEntities(
    String(rawSummary)
      .replace(/<br\s*\/?>/gi, '. ')
      .replace(/<\/p>/gi, '. ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();

const trimSummaryToWholeWords = (summary, maxLength = MAX_SUMMARY_LENGTH) => {
  if (summary.length <= maxLength) return summary;

  const buffer = summary.slice(0, maxLength + 1);
  const wordBreakIndex = buffer.lastIndexOf(' ');
  const safeCutIndex = wordBreakIndex > Math.floor(maxLength * 0.55) ? wordBreakIndex : maxLength;
  const shortened = buffer.slice(0, safeCutIndex).trim().replace(/[,:;.!?/-]+$/, '');
  return `${shortened}...`;
};

export const toShortSummary = (rawSummary = '', maxLength = MAX_SUMMARY_LENGTH) => {
  const normalizedSummary = normalizeSummaryText(rawSummary);
  if (!normalizedSummary) return SUMMARY_FALLBACK;

  const sentences =
    normalizedSummary.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
  const firstSentences = sentences.slice(0, MAX_SUMMARY_SENTENCES).join(' ').trim();
  const candidateSummary =
    firstSentences.length >= MIN_SUMMARY_LENGTH ? firstSentences : normalizedSummary;

  return trimSummaryToWholeWords(candidateSummary, maxLength);
};

const buildBookResult = ({ title, authors = [], summary = '', cover = '', mediaType = 'book', seriesType = '', source = '' }) => ({
  title: title || 'Unknown Title',
  authors: authors.length > 0 ? uniqueNonEmpty(authors) : ['Unknown Author'],
  summary: toShortSummary(summary),
  cover: cover || FALLBACK_COVER,
  mediaType: String(mediaType || '').toLowerCase() === 'manga' ? 'manga' : 'book',
  seriesType: String(seriesType || '').trim(),
  source: String(source || '').trim()
});

const isValidIsbn10 = (code) => {
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const char = code[i];
    const digit = char === 'X' ? 10 : Number(char);
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
};

const isValidIsbn13 = (code) => {
  if (!/^\d{13}$/.test(code)) return false;
  const check = Number(code[12]);
  const sum = code
    .slice(0, 12)
    .split('')
    .reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  const calculated = (10 - (sum % 10)) % 10;
  return check === calculated;
};

const isbn13FromTwelveDigits = (twelveDigits) => {
  if (!/^\d{12}$/.test(twelveDigits)) return null;
  const sum = twelveDigits
    .split('')
    .reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  const checkDigit = (10 - (sum % 10)) % 10;
  return `${twelveDigits}${checkDigit}`;
};

const isbn10FromIsbn13 = (isbn13) => {
  if (!isValidIsbn13(isbn13) || !isbn13.startsWith('978')) return null;
  const core = isbn13.slice(3, 12); // 9 digits
  const sum = core
    .split('')
    .reduce((acc, digit, index) => acc + Number(digit) * (10 - index), 0);
  const remainder = 11 - (sum % 11);
  const check = remainder === 10 ? 'X' : remainder === 11 ? '0' : String(remainder);
  return `${core}${check}`;
};

const extractCodeSeeds = (normalizedCode) => {
  const seeds = new Set();
  if (!normalizedCode) return [];

  seeds.add(normalizedCode);

  const digitsOnly = normalizedCode.replace(/X/g, '');
  if (digitsOnly) {
    if (digitsOnly.length === 14 && digitsOnly.startsWith('0')) {
      seeds.add(digitsOnly.slice(1));
    }

    const isbn13Matches = digitsOnly.match(/97[89]\d{10}/g) || [];
    isbn13Matches.forEach((match) => seeds.add(match));

    const ean13Matches = digitsOnly.match(/\d{13}/g) || [];
    ean13Matches.forEach((match) => seeds.add(match));

    const upcMatches = digitsOnly.match(/\d{12}/g) || [];
    upcMatches.forEach((match) => seeds.add(match));
  }

  const isbn10Matches = normalizedCode.match(/\d{9}[\dX]/g) || [];
  isbn10Matches.forEach((match) => seeds.add(match));

  return [...seeds].filter(Boolean);
};

const buildCodeCandidates = (rawCode) => {
  const code = normalizeBookCode(rawCode);
  const candidates = new Set();

  if (!code) return [];

  const seedCodes = extractCodeSeeds(code);
  seedCodes.forEach((seedCode) => candidates.add(seedCode));

  seedCodes.forEach((seedCode) => {
    if (/^\d{12}$/.test(seedCode)) {
      candidates.add(`0${seedCode}`); // UPC-A -> EAN-13
      const possibleIsbn13 = isbn13FromTwelveDigits(seedCode);
      if (possibleIsbn13) candidates.add(possibleIsbn13);
    }

    if (/^0\d{12}$/.test(seedCode)) {
      candidates.add(seedCode.slice(1));
    }

    if (isValidIsbn13(seedCode)) {
      const isbn10 = isbn10FromIsbn13(seedCode);
      if (isbn10) candidates.add(isbn10);
    }
  });

  return [...candidates];
};

const fetchAuthorName = async (authorRef) => {
  const authorKey =
    typeof authorRef === 'string'
      ? authorRef
      : authorRef?.author?.key || authorRef?.key;

  if (!authorKey) return 'Unknown Author';

  try {
    const response = await axios.get(`${OPEN_LIBRARY_BASE_URL}${authorKey}.json`, { timeout: REQUEST_TIMEOUT_MS });
    return response.data?.name || 'Unknown Author';
  } catch {
    return 'Unknown Author';
  }
};

const getOpenLibraryByIsbn = async (isbnCandidate) => {
  try {
    const editionResponse = await axios.get(`${OPEN_LIBRARY_BASE_URL}/isbn/${isbnCandidate}.json`, {
      timeout: REQUEST_TIMEOUT_MS
    });
    const edition = editionResponse.data;
    if (!edition?.title) return null;

    const authors = edition.authors
      ? await Promise.all(edition.authors.map((author) => fetchAuthorName(author)))
      : [];

    let summary = extractDescription(edition.description);
    let coverId = edition.covers?.[0];

    const workKey = edition.works?.[0]?.key;
    if (workKey) {
      try {
        const workResponse = await axios.get(`${OPEN_LIBRARY_BASE_URL}${workKey}.json`, {
          timeout: REQUEST_TIMEOUT_MS
        });
        const work = workResponse.data;
        if (!summary) summary = extractDescription(work?.description);
        if (!coverId) coverId = work?.covers?.[0];
      } catch {
        // fallback to edition data only
      }
    }

    const cover = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : FALLBACK_COVER;
    return buildBookResult({
      title: edition.title,
      authors,
      summary,
      cover
    });
  } catch {
    return null;
  }
};

const normalizeIndustryIdentifier = (identifier = '') => normalizeBookCode(identifier);

const pickBestGoogleItem = (items = [], candidateCodes = []) => {
  const candidateSet = new Set(candidateCodes.map((code) => normalizeBookCode(code)));
  let bestItem = null;
  let bestScore = -1;

  items.forEach((item) => {
    const identifiers = item?.volumeInfo?.industryIdentifiers || [];
    const normalizedIdentifiers = identifiers.map((entry) => normalizeIndustryIdentifier(entry?.identifier));

    let score = 0;
    if (normalizedIdentifiers.some((id) => candidateSet.has(id))) score += 6;
    if (identifiers.some((entry) => entry?.type?.includes('ISBN'))) score += 2;
    if (item?.volumeInfo?.imageLinks?.thumbnail || item?.volumeInfo?.imageLinks?.smallThumbnail) score += 1;
    if (item?.volumeInfo?.description) score += 1;
    if (item?.volumeInfo?.authors?.length) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  });

  return bestItem || items[0] || null;
};

const bookFromGoogleItem = (item) => {
  const info = item?.volumeInfo || {};
  if (!info.title) return null;

  const cover =
    toHttps(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '') || FALLBACK_COVER;
  const googleTypeSignals = [
    info.title,
    ...(Array.isArray(info.categories) ? info.categories : []),
    info.description
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const mediaType = /manga|tankobon|graphic novel|comic/.test(googleTypeSignals) ? 'manga' : 'book';

  return buildBookResult({
    title: info.title,
    authors: info.authors || [],
    summary: info.description || '',
    cover,
    mediaType,
    source: 'google-books'
  });
};

const getGoogleBooksByQuery = async (query, candidateCodes) => {
  try {
    const response = await axios.get(GOOGLE_BOOKS_BASE_URL, {
      params: {
        q: query,
        maxResults: 10,
        printType: 'books'
      },
      timeout: REQUEST_TIMEOUT_MS
    });

    const items = response.data?.items || [];
    if (items.length === 0) return null;

    const best = pickBestGoogleItem(items, candidateCodes);
    return bookFromGoogleItem(best);
  } catch {
    return null;
  }
};

const getOpenLibrarySearchByCode = async (code) => {
  try {
    const response = await axios.get(`${OPEN_LIBRARY_BASE_URL}/search.json`, {
      params: {
        q: code,
        limit: 10
      },
      timeout: REQUEST_TIMEOUT_MS
    });

    const docs = response.data?.docs || [];
    if (docs.length === 0) return null;

    const normalizedCode = normalizeBookCode(code);
    const bestDoc =
      docs.find((doc) => (doc.isbn || []).some((isbn) => normalizeBookCode(isbn) === normalizedCode)) ||
      docs[0];

    const cover = bestDoc.cover_i ? `https://covers.openlibrary.org/b/id/${bestDoc.cover_i}-L.jpg` : FALLBACK_COVER;
    const summary =
      typeof bestDoc.first_sentence === 'string'
        ? bestDoc.first_sentence
        : Array.isArray(bestDoc.first_sentence)
          ? bestDoc.first_sentence.find((sentence) => typeof sentence === 'string') || ''
          : '';

    return buildBookResult({
      title: bestDoc.title,
      authors: bestDoc.author_name || [],
      summary,
      cover
    });
  } catch {
    return null;
  }
};

export const getBookByISBN = async (bookCode) => {
  const normalizedCode = normalizeBookCode(bookCode);
  if (!normalizedCode) return null;

  const candidates = buildCodeCandidates(normalizedCode);
  const isbnCandidates = candidates.filter((candidate) => isValidIsbn10(candidate) || isValidIsbn13(candidate));

  for (const candidate of isbnCandidates) {
    const openLibraryBook = await getOpenLibraryByIsbn(candidate);
    if (openLibraryBook) return openLibraryBook;
  }

  const googleQueries = [
    ...isbnCandidates.map((candidate) => `isbn:${candidate}`),
    ...candidates.filter((candidate) => /^\d{8,13}$/.test(candidate)).map((candidate) => `upc:${candidate}`),
    ...candidates
  ];

  for (const query of uniqueNonEmpty(googleQueries)) {
    const googleBook = await getGoogleBooksByQuery(query, candidates);
    if (googleBook) return googleBook;
  }

  for (const candidate of candidates) {
    const openLibrarySearchBook = await getOpenLibrarySearchByCode(candidate);
    if (openLibrarySearchBook) return openLibrarySearchBook;
  }

  return null;
};

export const searchMangaByTitle = async (rawQuery) => {
  const query = String(rawQuery || '').trim();
  if (query.length < 2) return [];

  try {
    const response = await axios.get(JIKAN_MANGA_BASE_URL, {
      params: {
        q: query,
        limit: 10,
        order_by: 'score',
        sort: 'desc',
        sfw: true
      },
      timeout: REQUEST_TIMEOUT_MS
    });

    const items = Array.isArray(response.data?.data) ? response.data.data : [];
    if (items.length === 0) return [];

    return items
      .map((item) => {
        const cover =
          toHttps(item?.images?.jpg?.large_image_url || item?.images?.jpg?.image_url || item?.images?.webp?.image_url || '') ||
          FALLBACK_COVER;
        const authors = (Array.isArray(item?.authors) ? item.authors : [])
          .map((authorEntry) => String(authorEntry?.name || '').trim())
          .filter(Boolean);
        const summarySource = item?.synopsis || item?.background || '';
        return buildBookResult({
          title: item?.title_english || item?.title || 'Unknown Title',
          authors,
          summary: summarySource,
          cover,
          mediaType: 'manga',
          seriesType: item?.type || 'Manga',
          source: 'jikan'
        });
      })
      .filter((entry) => Boolean(entry?.title));
  } catch {
    return [];
  }
};
