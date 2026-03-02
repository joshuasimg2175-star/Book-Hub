# BookHub

BookHub is a React app for tracking books, scanning ISBN/barcodes, and viewing friend activity.

It now supports:
- Real account sign-up/sign-in
- Persistent backend data (users, sessions, books, friends)
- Cross-device sync when multiple devices point to the same API server

## Run Locally

1. Install dependencies

```bash
npm install
```

2. Start the backend API (terminal 1)

```bash
npm run api
```

3. Start the React app (terminal 2)

```bash
npm start
```

Frontend runs on `http://localhost:3000` and API on `http://localhost:4000`.

## Enable Google + Apple Sign-In

Add these values to `.env.local`:

```bash
REACT_APP_GOOGLE_CLIENT_ID=your_google_web_client_id
REACT_APP_APPLE_CLIENT_ID=your_apple_service_id
REACT_APP_APPLE_REDIRECT_URI=http://localhost:3000
```

Optional backend audience checks (recommended in production):

```bash
GOOGLE_CLIENT_ID=your_google_web_client_id
APPLE_CLIENT_ID=your_apple_service_id
```

Restart both frontend and backend after updating environment values.

## Security Hardening (Recommended)

Set backend environment values:

```bash
CORS_ALLOWED_ORIGINS=https://yourdomain.com
SESSION_MAX_AGE_MS=2592000000
SESSION_IDLE_TIMEOUT_MS=604800000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=240
AUTH_RATE_LIMIT_WINDOW_MS=600000
AUTH_RATE_LIMIT_MAX_REQUESTS=20
AUTH_RATE_LIMIT_BLOCK_MS=900000
ENABLE_HSTS=true
```

These enable:
- Origin allowlist for API CORS
- Session expiration and idle timeout
- API/auth rate limiting
- Security response headers

## Cross-Device Setup (Phone + Desktop)

1. Find your computer LAN IP (example: `192.168.0.50`).
2. In the project root, create `.env.local`:

```bash
REACT_APP_ENABLE_BACKEND=true
REACT_APP_API_BASE_URL=http://192.168.0.50:4000
```

3. Restart frontend and backend.
4. Open the frontend from your phone using `http://192.168.0.50:3000`.

Now sign-up/sign-in and library changes will sync through the same backend.

## API Data Persistence

The backend stores data in:

`server/data/db.json`

This file includes users, sessions, books, and friend relationships.

## Deploy To Production (Frontend + API)

For your current architecture (React app + Node API), use two services:

1. Static frontend host (Render Static Site, Netlify, or Vercel)
2. Node API host (Render Web Service, Railway, Fly.io, etc.)

### Recommended: Render (simple full-stack setup)

#### 1) Deploy API service

- Create a new **Web Service** from this repo.
- Root directory: `book-app` (or repo root if this project is root).
- Build command:

```bash
npm ci
```

- Start command:

```bash
npm run api
```

- Set environment values:
  - `NODE_ENV=production`
  - `PORT=4000` (optional, Render may provide it automatically)

After deploy, copy your API URL (example):

`https://bookhub-api.onrender.com`

#### 2) Deploy frontend service

- Create a **Static Site** from the same repo.
- Build command:

```bash
npm ci && npm run build
```

- Publish directory:

`build`

- Add environment values:
  - `REACT_APP_ENABLE_BACKEND=true`
  - `REACT_APP_API_BASE_URL=https://bookhub-api.onrender.com`

- Add SPA rewrite rule:
  - Source: `/*`
  - Destination: `/index.html`
  - Action: `Rewrite`

#### 3) Verify production

- Sign up a new account.
- Add a book.
- Add a friend.
- Refresh and confirm data persists.

### Important persistence note

Your API currently stores data in `server/data/db.json`.
On many cloud platforms, local disk can be ephemeral unless you attach persistent storage.

For long-term reliability, move to a database next (Postgres/Supabase) and keep `db.json` only for local dev.

## Available Scripts

- `npm start` - start React dev server
- `npm run api` - start backend API server
- `npm test` - run tests
- `npm run build` - create production build
