const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const crypto = require('crypto');

const toPositiveInt = (value, fallbackValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return Math.floor(parsed);
};

const normalizeOrigin = (value) => {
  try {
    const origin = new URL(String(value || '').trim()).origin;
    if (origin === 'null') return '';
    return origin;
  } catch {
    return '';
  }
};

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_BODY_BYTES = 1024 * 1024;
const HTTPS_REQUEST_TIMEOUT_MS = 12000;
const OAUTH_JWKS_CACHE_TTL_MS = 15 * 60 * 1000;
const OAUTH_FALLBACK_EMAIL_DOMAIN = 'privaterelay.bookhub.local';
const SESSION_MAX_AGE_MS = toPositiveInt(process.env.SESSION_MAX_AGE_MS, 1000 * 60 * 60 * 24 * 30);
const SESSION_IDLE_TIMEOUT_MS = toPositiveInt(process.env.SESSION_IDLE_TIMEOUT_MS, 1000 * 60 * 60 * 24 * 7);
const GENERAL_RATE_LIMIT_WINDOW_MS = toPositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 1000 * 60);
const GENERAL_RATE_LIMIT_MAX = toPositiveInt(process.env.RATE_LIMIT_MAX_REQUESTS, 240);
const AUTH_RATE_LIMIT_WINDOW_MS = toPositiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 1000 * 60 * 10);
const AUTH_RATE_LIMIT_MAX = toPositiveInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 20);
const AUTH_RATE_LIMIT_BLOCK_MS = toPositiveInt(process.env.AUTH_RATE_LIMIT_BLOCK_MS, 1000 * 60 * 15);
const ENABLE_HSTS = String(process.env.ENABLE_HSTS || 'true').trim().toLowerCase() !== 'false';
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const configuredOriginTokens = String(process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((entry) => String(entry || '').trim())
  .filter(Boolean);
const ALLOW_ALL_CORS_ORIGINS = configuredOriginTokens.includes('*');
const configuredOrigins = configuredOriginTokens
  .filter((origin) => origin !== '*')
  .map((entry) => normalizeOrigin(entry))
  .filter(Boolean);
const HAS_EXPLICIT_CORS_POLICY = configuredOriginTokens.length > 0;
const CORS_ALLOWED_ORIGIN_SET = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...configuredOrigins
]);
const rateLimitState = new Map();
const oauthJwksCache = new Map();

const nowIso = () => new Date().toISOString();
const normalizeId = (value) => (value === null || typeof value === 'undefined' ? '' : String(value).trim());
const normalizeIdList = (values) =>
  [...new Set((Array.isArray(values) ? values : [values]).map((value) => normalizeId(value)).filter(Boolean))];

const normalizeDbShape = (source) => {
  const safeSource = source && typeof source === 'object' ? source : {};
  const normalizedUsers = (Array.isArray(safeSource.users) ? safeSource.users : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const normalizedId = normalizeId(entry.id);
      if (!normalizedId) return null;
      return { ...entry, id: normalizedId };
    })
    .filter(Boolean);

  const normalizedSessions = (Array.isArray(safeSource.sessions) ? safeSource.sessions : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const userId = normalizeId(entry.userId);
      const token = String(entry.token || '').trim();
      if (!userId || !token) return null;
      return { ...entry, userId, token };
    })
    .filter(Boolean);

  const normalizedBooksByUser = {};
  Object.entries(safeSource.booksByUser && typeof safeSource.booksByUser === 'object' ? safeSource.booksByUser : {})
    .forEach(([rawUserId, rawBooks]) => {
      const userId = normalizeId(rawUserId);
      if (!userId) return;
      const existing = Array.isArray(normalizedBooksByUser[userId]) ? normalizedBooksByUser[userId] : [];
      const incoming = Array.isArray(rawBooks) ? rawBooks : [];
      normalizedBooksByUser[userId] = [...existing, ...incoming];
    });

  const normalizedFriendsByUser = {};
  Object.entries(safeSource.friendsByUser && typeof safeSource.friendsByUser === 'object' ? safeSource.friendsByUser : {})
    .forEach(([rawUserId, rawFriendIds]) => {
      const userId = normalizeId(rawUserId);
      if (!userId) return;
      const existing = Array.isArray(normalizedFriendsByUser[userId]) ? normalizedFriendsByUser[userId] : [];
      normalizedFriendsByUser[userId] = normalizeIdList([...existing, ...(Array.isArray(rawFriendIds) ? rawFriendIds : [])]);
    });

  const normalizedFriendRequests = (Array.isArray(safeSource.friendRequests) ? safeSource.friendRequests : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const id = normalizeId(entry.id);
      const fromUserId = normalizeId(entry.fromUserId);
      const toUserId = normalizeId(entry.toUserId);
      if (!id || !fromUserId || !toUserId) return null;
      return {
        ...entry,
        id,
        fromUserId,
        toUserId
      };
    })
    .filter(Boolean);

  return {
    users: normalizedUsers,
    sessions: normalizedSessions,
    booksByUser: normalizedBooksByUser,
    friendsByUser: normalizedFriendsByUser,
    friendRequests: normalizedFriendRequests,
    createdAt: safeSource.createdAt || nowIso(),
    updatedAt: safeSource.updatedAt || nowIso()
  };
};

const ensureDbFile = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    const initialDb = {
      users: [],
      sessions: [],
      booksByUser: {},
      friendsByUser: {},
      friendRequests: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), 'utf8');
  }
};

const loadDb = () => {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      booksByUser: parsed.booksByUser && typeof parsed.booksByUser === 'object' ? parsed.booksByUser : {},
      friendsByUser: parsed.friendsByUser && typeof parsed.friendsByUser === 'object' ? parsed.friendsByUser : {},
      friendRequests: Array.isArray(parsed.friendRequests) ? parsed.friendRequests : [],
      createdAt: parsed.createdAt || nowIso(),
      updatedAt: parsed.updatedAt || nowIso()
    };
  } catch {
    return {
      users: [],
      sessions: [],
      booksByUser: {},
      friendsByUser: {},
      friendRequests: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }
};

let db = normalizeDbShape(loadDb());

const persistDb = () => {
  db.updatedAt = nowIso();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
};

const toTimestamp = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const isSessionExpired = (session, nowMs = Date.now()) => {
  const createdAtMs = toTimestamp(session?.createdAt);
  const lastSeenAtMs = toTimestamp(session?.lastSeenAt || session?.createdAt);
  if (!createdAtMs || !lastSeenAtMs) return true;
  if (nowMs - createdAtMs > SESSION_MAX_AGE_MS) return true;
  if (nowMs - lastSeenAtMs > SESSION_IDLE_TIMEOUT_MS) return true;
  return false;
};

const pruneExpiredSessions = (nowMs = Date.now()) => {
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((session) => !isSessionExpired(session, nowMs));
  if (db.sessions.length !== before) {
    persistDb();
  }
};

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (ALLOW_ALL_CORS_ORIGINS) return true;
  if (CORS_ALLOWED_ORIGIN_SET.has(origin)) return true;

  if (!HAS_EXPLICIT_CORS_POLICY) {
    try {
      const hostname = new URL(origin).hostname.toLowerCase();
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        return true;
      }

      const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (match) {
        const octets = match.slice(1).map((entry) => Number(entry));
        const allValid = octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255);
        if (!allValid) return false;
        if (octets[0] === 10) return true;
        if (octets[0] === 192 && octets[1] === 168) return true;
        if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
      }
    } catch {
      return false;
    }
  }

  return false;
};

const getCorsHeaders = (req) => {
  const requestOrigin = normalizeOrigin(req?.headers?.origin);
  const corsHeaders = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };

  if (requestOrigin && isOriginAllowed(requestOrigin)) {
    corsHeaders['Access-Control-Allow-Origin'] = requestOrigin;
    corsHeaders.Vary = 'Origin';
  }

  return corsHeaders;
};

const getSecurityHeaders = (req) => {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  };

  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const isHttpsRequest = Boolean(req?.socket?.encrypted) || forwardedProto === 'https';
  if (ENABLE_HSTS && isHttpsRequest) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }

  return headers;
};

const getClientIp = (req) => {
  const forwardedHeader = String(req?.headers?.['x-forwarded-for'] || '').trim();
  if (forwardedHeader) {
    return forwardedHeader.split(',')[0].trim();
  }
  return String(req?.socket?.remoteAddress || 'unknown');
};

const pruneRateLimitState = (nowMs = Date.now()) => {
  if (rateLimitState.size <= 5000) return;
  for (const [key, entry] of rateLimitState.entries()) {
    if ((entry.resetAt || 0) + (AUTH_RATE_LIMIT_WINDOW_MS * 2) < nowMs && (entry.blockedUntil || 0) < nowMs) {
      rateLimitState.delete(key);
    }
  }
};

const checkRateLimit = (req, res, key, maxRequests, windowMs, blockMs = windowMs) => {
  const nowMs = Date.now();
  pruneRateLimitState(nowMs);

  const bucketKey = `${key}:${getClientIp(req)}`;
  const current = rateLimitState.get(bucketKey);
  const entry = current && nowMs < (current.resetAt || 0)
    ? current
    : { count: 0, resetAt: nowMs + windowMs, blockedUntil: 0 };

  if ((entry.blockedUntil || 0) > nowMs) {
    const retryAfter = Math.max(1, Math.ceil((entry.blockedUntil - nowMs) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    sendJson(res, 429, { error: 'Too many requests. Please try again later.' });
    return false;
  }

  entry.count += 1;
  if (entry.count > maxRequests) {
    entry.blockedUntil = nowMs + blockMs;
    entry.resetAt = nowMs + windowMs;
    rateLimitState.set(bucketKey, entry);
    const retryAfter = Math.max(1, Math.ceil((entry.blockedUntil - nowMs) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    sendJson(res, 429, { error: 'Too many requests. Please try again later.' });
    return false;
  }

  rateLimitState.set(bucketKey, entry);
  return true;
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(res.__securityHeaders || {}),
    ...(res.__corsHeaders || {})
  });
  res.end(JSON.stringify(payload));
};

const sendEmpty = (res, statusCode = 204) => {
  res.writeHead(statusCode, {
    ...(res.__securityHeaders || {}),
    ...(res.__corsHeaders || {})
  });
  res.end();
};

const readRequestBody = (req) =>
  new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json'));
      }
    });

    req.on('error', () => reject(new Error('request_error')));
  });

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const normalizeUsername = (username) => String(username || '').trim().toLowerCase();
const normalizeUsernameInput = (value) => normalizeUsername(String(value || '').replace(/^@+/, ''));
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 24;

const usernameSeed = (value) => {
  const cleaned = normalizeUsernameInput(value).replace(/[^a-z0-9]/g, '');
  if (cleaned.length >= USERNAME_MIN_LENGTH) {
    return cleaned.slice(0, USERNAME_MAX_LENGTH);
  }
  const fallback = `reader${cleaned}`.replace(/[^a-z0-9]/g, '');
  return (fallback.length >= USERNAME_MIN_LENGTH ? fallback : 'reader').slice(0, USERNAME_MAX_LENGTH);
};

const isValidUsername = (username) => {
  const value = normalizeUsernameInput(username);
  return /^[a-z0-9]{3,24}$/.test(value);
};

const getTakenUsernames = (excludeUserId = '') =>
  new Set(
    db.users
      .filter((user) => String(user.id) !== String(excludeUserId))
      .map((user) => normalizeUsername(user.username))
      .filter(Boolean)
  );

const generateUniqueUsername = (preferredValue, excludeUserId = '') => {
  const taken = getTakenUsernames(excludeUserId);
  const base = usernameSeed(preferredValue);
  let candidate = base;
  let suffix = 2;

  while (taken.has(candidate)) {
    const suffixText = String(suffix++);
    candidate = `${base.slice(0, USERNAME_MAX_LENGTH - suffixText.length)}${suffixText}`;
  }

  return candidate;
};

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  username: user.username,
  email: user.email,
  authProvider: user.authProvider || 'password',
  createdAt: user.createdAt
});

const ensureUsernamesInDb = () => {
  const known = new Set();
  let mutated = false;

  db.users = db.users.map((user) => {
    let username = normalizeUsernameInput(user.username);
    const valid = isValidUsername(username) && !known.has(username);

    if (!valid) {
      const fallbackBase = user.username || user.name || user.email || 'reader';
      const base = usernameSeed(fallbackBase);
      let candidate = base;
      let suffix = 2;
      while (known.has(candidate)) {
        const suffixText = String(suffix++);
        candidate = `${base.slice(0, USERNAME_MAX_LENGTH - suffixText.length)}${suffixText}`;
      }
      username = candidate;
      mutated = true;
    }

    known.add(username);
    if (username === user.username) return user;
    return { ...user, username };
  });

  if (mutated) {
    persistDb();
  }
};

const createId = (prefix) => {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
};

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return { hash, salt };
};

const verifyPassword = (inputPassword, hash, salt) => {
  if (!hash || !salt) return false;
  const candidateHash = crypto.scryptSync(String(inputPassword || ''), salt, 64).toString('hex');
  const left = Buffer.from(candidateHash, 'hex');
  const right = Buffer.from(String(hash || ''), 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

const getTokenFromRequest = (req) => {
  const header = String(req.headers.authorization || '').trim();
  if (!header) return '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return header;
};

const getSessionByToken = (token) => {
  const nowMs = Date.now();
  const session = db.sessions.find((entry) => entry.token === token);
  if (!session) return null;
  if (!isSessionExpired(session, nowMs)) return session;

  db.sessions = db.sessions.filter((entry) => entry.token !== token);
  persistDb();
  return null;
};

const requireAuth = (req, res) => {
  pruneExpiredSessions();
  const token = getTokenFromRequest(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing authorization token.' });
    return null;
  }

  const session = getSessionByToken(token);
  if (!session) {
    sendJson(res, 401, { error: 'Invalid or expired session.' });
    return null;
  }

  const user = db.users.find((entry) => String(entry.id) === String(session.userId));
  if (!user) {
    sendJson(res, 401, { error: 'Account for this session no longer exists.' });
    return null;
  }

  session.lastSeenAt = nowIso();
  persistDb();
  return { token, session, user };
};

const normalizeAuthors = (value) => {
  const authors = Array.isArray(value) ? value : [value];
  return authors.map((author) => String(author || '').trim()).filter(Boolean);
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

const normalizeBook = (book) => {
  const authors = normalizeAuthors(book?.authors);
  const safeTitle = String(book?.title || 'Unknown Title').trim() || 'Unknown Title';
  const safeSummary = String(book?.summary || '').trim();
  const mediaType = String(book?.mediaType || book?.format || '').trim().toLowerCase() === 'manga' ? 'manga' : 'book';
  const addedAt = String(book?.addedAt || '').trim() || nowIso();
  const updatedAt = String(book?.updatedAt || '').trim() || addedAt;

  return {
    id: String(book?.id || createId('book')),
    title: safeTitle,
    authors: authors.length > 0 ? authors : ['Unknown Author'],
    cover: String(book?.cover || 'https://via.placeholder.com/150x200').trim(),
    summary: safeSummary,
    description: String(book?.description || safeSummary).trim(),
    status: String(book?.status || 'unread').trim().toLowerCase(),
    thoughts: String(book?.thoughts || '').trim(),
    thoughtsContainSpoilers: normalizeBoolean(
      book?.thoughtsContainSpoilers ?? book?.hasSpoilerThoughts ?? book?.spoilerThoughts
    ),
    mediaType,
    seriesType: String(book?.seriesType || '').trim(),
    mangaVolume: mediaType === 'manga' ? normalizeMangaProgress(book?.mangaVolume ?? book?.volume) : '',
    mangaChapter: mediaType === 'manga' ? normalizeMangaProgress(book?.mangaChapter ?? book?.chapter) : '',
    arcTags: mediaType === 'manga' ? normalizeArcTags(book?.arcTags ?? book?.arcs) : [],
    addedAt,
    updatedAt
  };
};

const dedupeBooks = (books) => {
  const byKey = new Map();
  books.forEach((book) => {
    const normalized = normalizeBook(book);
    const key = `${normalized.title.trim().toLowerCase()}|${normalized.authors
      .map((author) => author.trim().toLowerCase())
      .sort()
      .join('|')}`;
    if (byKey.has(key)) {
      const existing = byKey.get(key);
      byKey.set(key, { ...existing, ...normalized, id: existing.id });
      return;
    }
    byKey.set(key, normalized);
  });
  return [...byKey.values()];
};

const createSession = (userId) => {
  pruneExpiredSessions();
  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = nowIso();
  const session = {
    token,
    userId: normalizeId(userId),
    createdAt,
    lastSeenAt: createdAt
  };
  db.sessions.push(session);
  return token;
};

const addFriendship = (userId, friendId) => {
  const left = normalizeId(userId);
  const right = normalizeId(friendId);
  if (!left || !right) return;

  if (!db.friendsByUser[left]) db.friendsByUser[left] = [];
  if (!db.friendsByUser[right]) db.friendsByUser[right] = [];

  const leftFriends = normalizeIdList(db.friendsByUser[left]);
  const rightFriends = normalizeIdList(db.friendsByUser[right]);

  if (!leftFriends.includes(right)) {
    leftFriends.push(right);
  }
  if (!rightFriends.includes(left)) {
    rightFriends.push(left);
  }

  db.friendsByUser[left] = leftFriends;
  db.friendsByUser[right] = rightFriends;
};

const removeFriendship = (userId, friendId) => {
  const left = normalizeId(userId);
  const right = normalizeId(friendId);

  if (Array.isArray(db.friendsByUser[left])) {
    db.friendsByUser[left] = db.friendsByUser[left].filter((id) => String(id) !== String(right));
  }
  if (Array.isArray(db.friendsByUser[right])) {
    db.friendsByUser[right] = db.friendsByUser[right].filter((id) => String(id) !== String(left));
  }
};

const findFriendByUsername = (input) => {
  const normalizedInput = normalizeUsernameInput(input);
  if (!normalizedInput) return null;
  return db.users.find((user) => normalizeUsername(user.username) === normalizedInput) || null;
};

const buildRequestView = (request) => {
  const fromUser = db.users.find((user) => String(user.id) === String(request.fromUserId));
  const toUser = db.users.find((user) => String(user.id) === String(request.toUserId));
  return {
    id: request.id,
    status: request.status,
    createdAt: request.createdAt,
    respondedAt: request.respondedAt || null,
    fromUser: fromUser ? sanitizeUser(fromUser) : null,
    toUser: toUser ? sanitizeUser(toUser) : null
  };
};

const fetchJson = (targetUrl, options = {}) =>
  new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      reject(new Error('invalid_url'));
      return;
    }

    const method = String(options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    const bodyPayload = options.body
      ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
      : '';
    if (bodyPayload && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (bodyPayload) {
      headers['Content-Length'] = Buffer.byteLength(bodyPayload);
    }

    const request = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const rawText = Buffer.concat(chunks).toString('utf8');
          let payload = null;
          if (rawText) {
            try {
              payload = JSON.parse(rawText);
            } catch {
              payload = rawText;
            }
          }

          if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
            const error = new Error(`http_${response.statusCode || 500}`);
            error.statusCode = response.statusCode || 500;
            error.payload = payload;
            reject(error);
            return;
          }

          resolve(payload);
        });
      }
    );

    request.setTimeout(Number(options.timeoutMs || HTTPS_REQUEST_TIMEOUT_MS), () => {
      request.destroy(new Error('http_timeout'));
    });

    request.on('error', (error) => reject(error));

    if (bodyPayload) {
      request.write(bodyPayload);
    }
    request.end();
  });

const decodeBase64UrlToBuffer = (segment) => {
  const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLength = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  return Buffer.from(`${normalized}${'='.repeat(padLength)}`, 'base64');
};

const decodeJwt = (token) => {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('invalid_jwt');
  }

  const header = JSON.parse(decodeBase64UrlToBuffer(parts[0]).toString('utf8'));
  const payload = JSON.parse(decodeBase64UrlToBuffer(parts[1]).toString('utf8'));
  const signature = decodeBase64UrlToBuffer(parts[2]);
  return {
    header,
    payload,
    signature,
    signingInput: `${parts[0]}.${parts[1]}`
  };
};

const getCachedJwks = async (cacheKey, url) => {
  const now = Date.now();
  const cached = oauthJwksCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.keys;
  }

  const response = await fetchJson(url, { timeoutMs: HTTPS_REQUEST_TIMEOUT_MS });
  const keys = Array.isArray(response?.keys) ? response.keys : [];
  if (keys.length === 0) {
    throw new Error('jwks_unavailable');
  }

  oauthJwksCache.set(cacheKey, {
    keys,
    expiresAt: now + OAUTH_JWKS_CACHE_TTL_MS
  });

  return keys;
};

const toDisplayNameFromEmail = (email) => {
  const localPart = String(email || '').split('@')[0] || 'reader';
  const cleaned = localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'Reader';

  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const getProviderSubjectField = (provider) => (provider === 'apple' ? 'appleSubject' : 'googleSubject');

const findUserByProviderSubject = (provider, providerSubject) => {
  const field = getProviderSubjectField(provider);
  const normalizedSubject = normalizeId(providerSubject);
  if (!normalizedSubject) return null;
  return db.users.find((user) => normalizeId(user[field]) === normalizedSubject) || null;
};

const normalizeProfileName = (value) => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  return [value.firstName, value.lastName, value.givenName, value.familyName]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
};

const buildProviderFallbackEmail = (provider, providerSubject) => {
  const safeProvider = String(provider || 'user').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'user';
  const safeSubject = String(providerSubject || createId('acct')).replace(/[^a-z0-9]/gi, '').toLowerCase() || createId('acct');
  return `${safeProvider}-${safeSubject}@${OAUTH_FALLBACK_EMAIL_DOMAIN}`;
};

const upsertOAuthUser = ({ provider, providerSubject, email, name }) => {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (normalizedProvider !== 'google' && normalizedProvider !== 'apple') {
    throw new Error('unsupported_oauth_provider');
  }

  const subjectField = getProviderSubjectField(normalizedProvider);
  const normalizedSubject = normalizeId(providerSubject);
  const normalizedEmail = normalizeEmail(email);
  const safeName = String(name || '').trim();

  let user = normalizedSubject ? findUserByProviderSubject(normalizedProvider, normalizedSubject) : null;
  if (!user && normalizedEmail) {
    user = db.users.find((entry) => normalizeEmail(entry.email) === normalizedEmail) || null;
  }

  if (!user) {
    const resolvedEmail = normalizedEmail || buildProviderFallbackEmail(normalizedProvider, normalizedSubject);
    const resolvedName = safeName || toDisplayNameFromEmail(resolvedEmail);
    user = {
      id: createId('user'),
      name: resolvedName,
      username: generateUniqueUsername(resolvedName || resolvedEmail),
      email: resolvedEmail,
      createdAt: nowIso(),
      authProvider: normalizedProvider,
      googleSubject: normalizedProvider === 'google' ? normalizedSubject : '',
      appleSubject: normalizedProvider === 'apple' ? normalizedSubject : ''
    };
    db.users.push(user);
    db.booksByUser[user.id] = db.booksByUser[user.id] || [];
    db.friendsByUser[user.id] = db.friendsByUser[user.id] || [];
    return user;
  }

  if (normalizedSubject) {
    user[subjectField] = normalizedSubject;
  }

  if (normalizedEmail && !normalizeEmail(user.email)) {
    user.email = normalizedEmail;
  }

  if (safeName.length >= 2) {
    user.name = safeName;
  }

  if (!isValidUsername(user.username)) {
    user.username = generateUniqueUsername(user.name || user.email, user.id);
  }

  user.authProvider = normalizedProvider;
  db.booksByUser[user.id] = db.booksByUser[user.id] || [];
  db.friendsByUser[user.id] = db.friendsByUser[user.id] || [];
  return user;
};

const resolveGoogleProfileFromAccessToken = async (accessToken) => {
  const token = String(accessToken || '').trim();
  if (!token) {
    throw new Error('google_access_token_missing');
  }

  const profile = await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const email = normalizeEmail(profile?.email);
  const providerSubject = normalizeId(profile?.sub);
  if (!email || !providerSubject) {
    throw new Error('google_profile_incomplete');
  }

  const name = String(profile?.name || profile?.given_name || toDisplayNameFromEmail(email)).trim();
  return {
    providerSubject,
    email,
    name
  };
};

const resolveGoogleProfileFromIdToken = async (idToken) => {
  const token = String(idToken || '').trim();
  if (!token) {
    throw new Error('google_id_token_missing');
  }

  const profile = await fetchJson(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  const email = normalizeEmail(profile?.email);
  const providerSubject = normalizeId(profile?.sub);
  if (!email || !providerSubject) {
    throw new Error('google_profile_incomplete');
  }

  const configuredGoogleClientId = String(process.env.GOOGLE_CLIENT_ID || process.env.REACT_APP_GOOGLE_CLIENT_ID || '').trim();
  if (configuredGoogleClientId && String(profile?.aud || '').trim() && String(profile.aud).trim() !== configuredGoogleClientId) {
    throw new Error('google_audience_mismatch');
  }

  const name = String(profile?.name || profile?.given_name || toDisplayNameFromEmail(email)).trim();
  return {
    providerSubject,
    email,
    name
  };
};

const resolveAppleProfileFromIdToken = async (idToken) => {
  const token = String(idToken || '').trim();
  if (!token) {
    throw new Error('apple_id_token_missing');
  }

  const decoded = decodeJwt(token);
  if (String(decoded.header?.alg || '').toUpperCase() !== 'RS256') {
    throw new Error('apple_jwt_alg_unsupported');
  }

  const appleJwks = await getCachedJwks('apple', 'https://appleid.apple.com/auth/keys');
  const matchingKey = appleJwks.find((key) => String(key?.kid || '') === String(decoded.header?.kid || ''));
  if (!matchingKey) {
    throw new Error('apple_signing_key_missing');
  }

  const keyObject = crypto.createPublicKey({
    key: matchingKey,
    format: 'jwk'
  });
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(decoded.signingInput);
  verifier.end();
  if (!verifier.verify(keyObject, decoded.signature)) {
    throw new Error('apple_signature_invalid');
  }

  const issuer = String(decoded.payload?.iss || '');
  if (issuer !== 'https://appleid.apple.com') {
    throw new Error('apple_issuer_invalid');
  }

  const expirationSeconds = Number(decoded.payload?.exp || 0);
  if (!Number.isFinite(expirationSeconds) || Date.now() >= expirationSeconds * 1000) {
    throw new Error('apple_token_expired');
  }

  const configuredAppleClientId = String(process.env.APPLE_CLIENT_ID || process.env.REACT_APP_APPLE_CLIENT_ID || '').trim();
  if (configuredAppleClientId) {
    const aud = String(decoded.payload?.aud || '').trim();
    if (aud !== configuredAppleClientId) {
      throw new Error('apple_audience_mismatch');
    }
  }

  const providerSubject = normalizeId(decoded.payload?.sub);
  const email = normalizeEmail(decoded.payload?.email);
  if (!providerSubject) {
    throw new Error('apple_subject_missing');
  }

  return {
    providerSubject,
    email
  };
};

ensureUsernamesInDb();
pruneExpiredSessions();

const handleSignup = async (req, res) => {
  const body = await readRequestBody(req);
  const name = String(body?.name || '').trim();
  const email = normalizeEmail(body?.email);
  const password = String(body?.password || '');
  const requestedUsername = normalizeUsernameInput(body?.username);

  if (name.length < 2) return sendJson(res, 400, { error: 'Name must be at least 2 characters.' });
  if (!email) return sendJson(res, 400, { error: 'Email is required.' });
  if (password.length < 6) return sendJson(res, 400, { error: 'Password must be at least 6 characters.' });

  const existing = db.users.find((user) => normalizeEmail(user.email) === email);
  if (existing) return sendJson(res, 409, { error: 'An account with that email already exists.' });

  let username = '';
  if (requestedUsername) {
    if (!isValidUsername(requestedUsername)) {
      return sendJson(res, 400, {
        error: `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters and use letters/numbers only.`
      });
    }
    const conflict = db.users.find((user) => normalizeUsername(user.username) === requestedUsername);
    if (conflict) {
      return sendJson(res, 409, { error: 'That username is already taken.' });
    }
    username = requestedUsername;
  } else {
    username = generateUniqueUsername(name || email);
  }

  const userId = createId('user');
  const passwordData = hashPassword(password);
  const createdAt = nowIso();
  const user = {
    id: userId,
    name,
    username,
    email,
    createdAt,
    authProvider: 'password',
    googleSubject: '',
    appleSubject: '',
    passwordHash: passwordData.hash,
    passwordSalt: passwordData.salt
  };

  db.users.push(user);
  db.booksByUser[user.id] = db.booksByUser[user.id] || [];
  db.friendsByUser[user.id] = db.friendsByUser[user.id] || [];

  const token = createSession(user.id);
  persistDb();

  return sendJson(res, 201, {
    user: sanitizeUser(user),
    token
  });
};

const handleLogin = async (req, res) => {
  const body = await readRequestBody(req);
  const email = normalizeEmail(body?.email);
  const password = String(body?.password || '');

  if (!email || !password) {
    return sendJson(res, 400, { error: 'Email and password are required.' });
  }

  const user = db.users.find((entry) => normalizeEmail(entry.email) === email);
  if (!user) return sendJson(res, 401, { error: 'Incorrect email or password.' });

  const isPasswordValid = verifyPassword(password, user.passwordHash, user.passwordSalt);
  if (!isPasswordValid) return sendJson(res, 401, { error: 'Incorrect email or password.' });

  const token = createSession(user.id);
  persistDb();

  return sendJson(res, 200, {
    user: sanitizeUser(user),
    token
  });
};

const handleGoogleOAuthLogin = async (req, res) => {
  const body = await readRequestBody(req);
  const accessToken = String(body?.accessToken || '').trim();
  const idToken = String(body?.idToken || body?.credential || '').trim();

  if (!accessToken && !idToken) {
    return sendJson(res, 400, { error: 'Google access token is required.' });
  }

  try {
    const profile = accessToken
      ? await resolveGoogleProfileFromAccessToken(accessToken)
      : await resolveGoogleProfileFromIdToken(idToken);

    const user = upsertOAuthUser({
      provider: 'google',
      providerSubject: profile.providerSubject,
      email: profile.email,
      name: profile.name
    });

    const token = createSession(user.id);
    persistDb();
    return sendJson(res, 200, {
      user: sanitizeUser(user),
      token
    });
  } catch {
    return sendJson(res, 401, { error: 'Google sign-in failed. Please try again.' });
  }
};

const handleAppleOAuthLogin = async (req, res) => {
  const body = await readRequestBody(req);
  const idToken = String(body?.idToken || body?.identityToken || '').trim();
  if (!idToken) {
    return sendJson(res, 400, { error: 'Apple identity token is required.' });
  }

  try {
    const profile = await resolveAppleProfileFromIdToken(idToken);
    const claimedName = normalizeProfileName(body?.name) || normalizeProfileName(body?.fullName);
    const claimedEmail = normalizeEmail(body?.email);
    const resolvedEmail = profile.email || claimedEmail || buildProviderFallbackEmail('apple', profile.providerSubject);

    const user = upsertOAuthUser({
      provider: 'apple',
      providerSubject: profile.providerSubject,
      email: resolvedEmail,
      name: claimedName || toDisplayNameFromEmail(resolvedEmail)
    });

    const token = createSession(user.id);
    persistDb();
    return sendJson(res, 200, {
      user: sanitizeUser(user),
      token
    });
  } catch {
    return sendJson(res, 401, { error: 'Apple sign-in failed. Please try again.' });
  }
};

const handleUpdateProfile = async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const body = await readRequestBody(req);
  const hasName = Object.prototype.hasOwnProperty.call(body || {}, 'name');
  const hasUsername = Object.prototype.hasOwnProperty.call(body || {}, 'username');

  if (!hasName && !hasUsername) {
    return sendJson(res, 400, { error: 'Provide a name and/or username to update.' });
  }

  if (hasName) {
    const name = String(body?.name || '').trim();
    if (name.length < 2) {
      return sendJson(res, 400, { error: 'Name must be at least 2 characters.' });
    }
    if (name.length > 80) {
      return sendJson(res, 400, { error: 'Name must be 80 characters or fewer.' });
    }
    auth.user.name = name;
  }

  if (hasUsername) {
    const username = normalizeUsernameInput(body?.username);
    if (!isValidUsername(username)) {
      return sendJson(res, 400, {
        error: `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters and use letters/numbers only.`
      });
    }
    const conflict = db.users.find(
      (user) => String(user.id) !== String(auth.user.id) && normalizeUsername(user.username) === username
    );
    if (conflict) {
      return sendJson(res, 409, { error: 'That username is already taken.' });
    }
    auth.user.username = username;
  }

  persistDb();
  return sendJson(res, 200, { user: sanitizeUser(auth.user) });
};

const handleGetBooks = (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const books = Array.isArray(db.booksByUser[auth.user.id]) ? db.booksByUser[auth.user.id] : [];
  return sendJson(res, 200, { books });
};

const handlePutBooks = async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const body = await readRequestBody(req);
  if (!Array.isArray(body?.books)) {
    return sendJson(res, 400, { error: 'books must be an array.' });
  }

  db.booksByUser[auth.user.id] = dedupeBooks(body.books);
  persistDb();
  return sendJson(res, 200, { books: db.booksByUser[auth.user.id] });
};

const handleUpsertBook = async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const body = await readRequestBody(req);
  const payloadBook = body?.book;
  if (!payloadBook || typeof payloadBook !== 'object') {
    return sendJson(res, 400, { error: 'book is required.' });
  }

  const normalized = normalizeBook(payloadBook);
  const list = Array.isArray(db.booksByUser[auth.user.id]) ? db.booksByUser[auth.user.id] : [];

  const byIdIndex = list.findIndex((book) => String(book.id) === String(normalized.id));
  const duplicateKey = `${normalized.title.trim().toLowerCase()}|${normalized.authors
    .map((author) => author.trim().toLowerCase())
    .sort()
    .join('|')}`;
  const byContentIndex = list.findIndex((book) => {
    const candidateKey = `${String(book.title || '').trim().toLowerCase()}|${normalizeAuthors(book.authors)
      .map((author) => author.trim().toLowerCase())
      .sort()
      .join('|')}`;
    return candidateKey === duplicateKey;
  });

  const indexToUpdate = byIdIndex >= 0 ? byIdIndex : byContentIndex;
  if (indexToUpdate >= 0) {
    list[indexToUpdate] = {
      ...list[indexToUpdate],
      ...normalized,
      id: list[indexToUpdate].id
    };
  } else {
    list.push(normalized);
  }

  db.booksByUser[auth.user.id] = list;
  persistDb();
  return sendJson(res, 200, {
    book: indexToUpdate >= 0 ? list[indexToUpdate] : normalized
  });
};

const handleDeleteBooks = (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  db.booksByUser[auth.user.id] = [];
  persistDb();
  return sendJson(res, 200, { books: [] });
};

const handleGetFriends = (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const userId = normalizeId(auth.user.id);
  const friendIds = normalizeIdList(db.friendsByUser[userId]);
  const friendDetails = friendIds
    .map((id) => db.users.find((user) => String(user.id) === String(id)))
    .filter(Boolean)
    .map((user) => sanitizeUser(user));
  return sendJson(res, 200, { friends: friendDetails });
};

const handleAddFriend = async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const body = await readRequestBody(req);
  const input = normalizeUsernameInput(body?.username || body?.name || '');
  if (!isValidUsername(input)) {
    return sendJson(res, 400, {
      error: `Friend username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} letters or numbers.`
    });
  }

  const friend = findFriendByUsername(input);
  if (!friend) {
    return sendJson(res, 404, { error: 'No account found with that username.' });
  }
  if (String(friend.id) === String(auth.user.id)) {
    return sendJson(res, 400, { error: 'You cannot add yourself as a friend.' });
  }

  const userId = normalizeId(auth.user.id);
  const friendId = normalizeId(friend.id);
  const currentFriendIds = normalizeIdList(db.friendsByUser[userId]);
  const alreadyFriend = currentFriendIds.some((id) => String(id) === String(friendId));
  if (alreadyFriend) {
    return sendJson(res, 200, { friend: sanitizeUser(friend), alreadyFriend: true });
  }

  const existingOutgoingPending = db.friendRequests.find(
    (request) =>
      String(request.fromUserId) === String(userId) &&
      String(request.toUserId) === String(friendId) &&
      request.status === 'pending'
  );
  if (existingOutgoingPending) {
    return sendJson(res, 200, {
      friend: sanitizeUser(friend),
      requestPending: true,
      direction: 'outgoing',
      requestId: existingOutgoingPending.id
    });
  }

  const existingIncomingPending = db.friendRequests.find(
    (request) =>
      String(request.fromUserId) === String(friendId) &&
      String(request.toUserId) === String(userId) &&
      request.status === 'pending'
  );

  if (existingIncomingPending) {
    existingIncomingPending.status = 'accepted';
    existingIncomingPending.respondedAt = nowIso();
    addFriendship(userId, friendId);
    persistDb();
    return sendJson(res, 200, {
      friend: sanitizeUser(friend),
      accepted: true,
      requestId: existingIncomingPending.id
    });
  }

  const request = {
    id: createId('frq'),
    fromUserId: userId,
    toUserId: friendId,
    status: 'pending',
    createdAt: nowIso(),
    respondedAt: null
  };
  db.friendRequests.push(request);
  persistDb();
  return sendJson(res, 201, {
    friend: sanitizeUser(friend),
    requestPending: true,
    direction: 'outgoing',
    requestId: request.id
  });
};

const handleGetFriendRequests = (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const userId = normalizeId(auth.user.id);

  const incoming = db.friendRequests
    .filter((request) => String(request.toUserId) === String(userId) && request.status === 'pending')
    .map((request) => buildRequestView(request));

  const outgoing = db.friendRequests
    .filter((request) => String(request.fromUserId) === String(userId) && request.status === 'pending')
    .map((request) => buildRequestView(request));

  return sendJson(res, 200, { incoming, outgoing });
};

const handleRespondToFriendRequest = (req, res, requestId, action) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const userId = normalizeId(auth.user.id);
  const normalizedRequestId = normalizeId(requestId);

  const request = db.friendRequests.find(
    (entry) =>
      String(entry.id) === String(normalizedRequestId) &&
      String(entry.toUserId) === String(userId) &&
      entry.status === 'pending'
  );
  if (!request) {
    return sendJson(res, 404, { error: 'Friend request not found.' });
  }

  if (action === 'accept') {
    request.status = 'accepted';
    addFriendship(request.fromUserId, request.toUserId);
  } else {
    request.status = 'declined';
  }
  request.respondedAt = nowIso();
  persistDb();

  const friend = db.users.find((user) => String(user.id) === String(request.fromUserId));
  return sendJson(res, 200, {
    request: buildRequestView(request),
    friend: friend ? sanitizeUser(friend) : null
  });
};

const handleRemoveFriend = (req, res, friendId) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const userId = normalizeId(auth.user.id);
  const normalizedFriendId = normalizeId(friendId);

  if (!normalizedFriendId) {
    return sendJson(res, 400, { error: 'Friend id is required.' });
  }

  if (String(normalizedFriendId) === String(userId)) {
    return sendJson(res, 400, { error: 'You cannot remove yourself.' });
  }

  const currentFriendIds = normalizeIdList(db.friendsByUser[userId]);
  if (!currentFriendIds.some((id) => String(id) === String(normalizedFriendId))) {
    return sendJson(res, 404, { error: 'Friend not found in your list.' });
  }

  removeFriendship(userId, normalizedFriendId);
  db.friendRequests = db.friendRequests.map((request) => {
    const isBetweenUsers =
      (String(request.fromUserId) === String(userId) && String(request.toUserId) === String(normalizedFriendId)) ||
      (String(request.fromUserId) === String(normalizedFriendId) && String(request.toUserId) === String(userId));
    if (!isBetweenUsers || request.status !== 'pending') return request;
    return {
      ...request,
      status: 'declined',
      respondedAt: nowIso()
    };
  });

  persistDb();
  return sendJson(res, 200, {
    success: true,
    removedFriendId: normalizedFriendId,
    friends: normalizeIdList(db.friendsByUser[userId]).map((id) => {
      const user = db.users.find((entry) => String(entry.id) === String(id));
      return user ? sanitizeUser(user) : null;
    }).filter(Boolean)
  });
};

const handleGetFriendBooks = (req, res, friendId) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const userId = normalizeId(auth.user.id);
  const normalizedFriendId = normalizeId(friendId);

  const friendIds = normalizeIdList(db.friendsByUser[userId]);
  if (!friendIds.some((id) => String(id) === String(normalizedFriendId))) {
    return sendJson(res, 403, { error: 'Friend access denied.' });
  }

  const friendBooks = Array.isArray(db.booksByUser[normalizedFriendId]) ? db.booksByUser[normalizedFriendId] : [];
  return sendJson(res, 200, { books: friendBooks });
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = requestUrl;
  res.__corsHeaders = getCorsHeaders(req);
  res.__securityHeaders = getSecurityHeaders(req);

  const requestOrigin = normalizeOrigin(req.headers.origin);
  if (requestOrigin && !isOriginAllowed(requestOrigin)) {
    return sendJson(res, 403, { error: 'Origin not allowed.' });
  }

  if (req.method !== 'OPTIONS' && pathname.startsWith('/api/')) {
    if (!checkRateLimit(req, res, 'api', GENERAL_RATE_LIMIT_MAX, GENERAL_RATE_LIMIT_WINDOW_MS)) {
      return;
    }
  }

  if (req.method !== 'OPTIONS' && pathname.startsWith('/api/auth') && req.method !== 'GET') {
    if (!checkRateLimit(req, res, 'auth', AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS, AUTH_RATE_LIMIT_BLOCK_MS)) {
      return;
    }
  }

  if (req.method === 'OPTIONS') {
    return sendEmpty(res);
  }

  try {
    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        updatedAt: db.updatedAt,
        users: db.users.length
      });
    }

    if (req.method === 'POST' && pathname === '/api/auth/signup') return handleSignup(req, res);
    if (req.method === 'POST' && pathname === '/api/auth/login') return handleLogin(req, res);
    if (req.method === 'POST' && pathname === '/api/auth/oauth/google') return handleGoogleOAuthLogin(req, res);
    if (req.method === 'POST' && pathname === '/api/auth/oauth/apple') return handleAppleOAuthLogin(req, res);
    if (req.method === 'GET' && pathname === '/api/auth/me') {
      const auth = requireAuth(req, res);
      if (!auth) return;
      return sendJson(res, 200, { user: sanitizeUser(auth.user) });
    }
    if ((req.method === 'PUT' || req.method === 'PATCH') && pathname === '/api/auth/profile') {
      return handleUpdateProfile(req, res);
    }
    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const auth = requireAuth(req, res);
      if (!auth) return;
      db.sessions = db.sessions.filter((session) => session.token !== auth.token);
      persistDb();
      return sendJson(res, 200, { success: true });
    }

    if (req.method === 'GET' && pathname === '/api/books') return handleGetBooks(req, res);
    if (req.method === 'PUT' && pathname === '/api/books') return handlePutBooks(req, res);
    if (req.method === 'POST' && pathname === '/api/books/upsert') return handleUpsertBook(req, res);
    if (req.method === 'DELETE' && pathname === '/api/books') return handleDeleteBooks(req, res);

    if (req.method === 'GET' && pathname === '/api/friends') return handleGetFriends(req, res);
    if (req.method === 'POST' && pathname === '/api/friends') return handleAddFriend(req, res);
    if (req.method === 'GET' && pathname === '/api/friends/requests') return handleGetFriendRequests(req, res);
    const requestActionMatch = pathname.match(/^\/api\/friends\/requests\/([^/]+)\/(accept|decline)$/);
    if (req.method === 'POST' && requestActionMatch) {
      return handleRespondToFriendRequest(req, res, requestActionMatch[1], requestActionMatch[2]);
    }
    const removeFriendMatch = pathname.match(/^\/api\/friends\/([^/]+)$/);
    if (req.method === 'DELETE' && removeFriendMatch) {
      return handleRemoveFriend(req, res, removeFriendMatch[1]);
    }
    const friendBooksMatch = pathname.match(/^\/api\/friends\/([^/]+)\/books$/);
    if (req.method === 'GET' && friendBooksMatch) {
      return handleGetFriendBooks(req, res, friendBooksMatch[1]);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    if (error?.message === 'payload_too_large') {
      return sendJson(res, 413, { error: 'Request body is too large.' });
    }
    if (error?.message === 'invalid_json') {
      return sendJson(res, 400, { error: 'Invalid JSON body.' });
    }
    return sendJson(res, 500, { error: 'Internal server error.' });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`BookHub API listening on http://${HOST}:${PORT}`);
});
