# 🔖 Better Bookmarks 2

> A self-hosted bookmark manager with end-to-end encryption — your data never leaves your browser unencrypted.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org) [![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev) [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

---

## ✨ Key Features

|     | Feature                            | Description                                                                                                                  |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 🔐  | **End-to-end encryption**          | All data (title, URL, thumbnail, tags) is AES-256-GCM encrypted in the browser before it ever reaches the server             |
| 🕵️  | **Zero-knowledge backend**         | The server stores only ciphertext — your encryption key never leaves your browser                                            |
| 🔑  | **PBKDF2 key derivation**          | Your key is derived from your password + email with 600,000 SHA-256 iterations; non-extractable and memory-only              |
| 🏷️  | **Tag management**                 | Create tags, assign multiple per bookmark, filter by tag — uniqueness enforced via HMAC without exposing plaintext to the DB |
| 🔍  | **Real-time search**               | Client-side search across title and URL, combined with tag filtering using AND logic                                         |
| 📥  | **Import**                         | CSV (RFC 4180, max 5 MB / 500 rows) and JSON (Better Bookmarks v1 format, max 100 MB / 5000 bookmarks)                       |
| 📤  | **Export**                         | JSON (full fidelity, includes thumbnails as encrypted base64 JPEG data URIs) and CSV; both cancellable                       |
| 🖼️  | **Thumbnail upload**               | Images compressed to 480×270 px at JPEG 0.75 quality via Canvas API, then encrypted before upload                            |
| ♾️  | **Infinite scroll**                | Page size 20 via IntersectionObserver; switches to full load when search or tag filter is active                             |
| 🔄  | **Password change + key rotation** | Re-encrypts all bookmarks, tags, and thumbnails with the new key before updating server state                                |
| 🗑️  | **Account deletion**               | Password-confirmed hard delete via PostgREST RPC                                                                             |

---

## 🛡️ Security Model

Better Bookmarks 2 follows a zero-knowledge architecture:

- 🔐 **Encryption key** — derived from `password + email` via PBKDF2-SHA256 (600,000 iterations). The key is marked non-extractable by the Web Crypto API and held only in memory. It is wiped on logout and never written to `localStorage`, `sessionStorage`, or any cookie.
- 🎟️ **JWT** — also kept in memory only. It is injected into request headers at call time and wiped on logout, preventing XSS exfiltration between sessions.
- 🏷️ **Tag uniqueness** — enforced by storing `HMAC-SHA256(userId, tagName)` as `name_hmac`. The database enforces a UNIQUE constraint on this column without ever seeing the plaintext tag name.
- 🚧 **API error sanitization** — only `400`, `401`, and `409` responses relay PostgREST messages to the client. All other error statuses return a generic message to prevent database schema leakage.

---

## 🐳 Self-Hosting / Production Deployment

The recommended way to self-host Better Bookmarks 2 is with Docker. Everything you need is included in the repository — a multi-stage `Dockerfile`, a hardened Nginx config, and a `docker-compose.yml` that wires up the frontend, PostgREST, and PostgreSQL.

**1. Clone the repository** (you need `docker-compose.yml` and the `./docker` directory):

```bash
git clone https://github.com/finn24-09/better-bookmarks2.git
cd better-bookmarks2
```

**2. Create your environment file** from the template:

```bash
cp .env.example .env
```

Open `.env` and set your own values for `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `PGRST_JWT_SECRET` (generate the secret with `openssl rand -base64 48`).

**3. Start the full stack** in production mode:

```bash
docker compose -f docker-compose.yml up -d
```

> The `-f docker-compose.yml` flag is required to skip `docker-compose.override.yml`, which contains development-only settings.

The app is available at **http://localhost** once all containers are healthy. 🎉

The stack runs three containers on an isolated bridge network:

| Container     | Role                                                                        |
| ------------- | --------------------------------------------------------------------------- |
| **frontend**  | Nginx — serves the built React app and proxies `/api/*` to PostgREST        |
| **postgrest** | PostgREST v12 — internal only, never exposed publicly                       |
| **db**        | PostgreSQL 16 — schema and RLS policies pre-applied via `./docker/db/init/` |

PostgreSQL data is persisted in a named Docker volume.

---

## 💻 Local Development

**Prerequisites:**

- Node.js 20 or later
- PostgREST running on `http://localhost:3000`, connected to your PostgreSQL database

**1.** Install dependencies:

```bash
npm install
```

**2.** Start the development server:

```bash
npm run dev
```

Vite proxies all `/api/*` requests to `http://localhost:3000`, stripping the `/api` prefix before forwarding to PostgREST.

**3.** Open your browser at **http://localhost:5173**.

### Dev commands

```bash
npm run dev          # start Vite dev server at http://localhost:5173
npm test             # single test run (used in CI)
npm run test:watch   # watch mode for TDD
```

This project uses test-driven development. Write a failing test before implementing any feature or fixing any bug. All test files mirror the source tree with a `.test.ts` / `.test.tsx` suffix.

---

## 📥 Import / Export

### CSV import

| Column          | Required | Description                                  |
| --------------- | -------- | -------------------------------------------- |
| `title`         | ✅ Yes   | Bookmark title                               |
| `url`           | ✅ Yes   | Bookmark URL (`http://` or `https://` only)  |
| `tags`          | No       | Pipe-separated tag names, e.g. `work\|tools` |
| `thumbnail url` | No       | URL to a thumbnail image                     |

Limits: max **5 MB** file size, max **500 rows**.

```
title,url,tags,thumbnail url
My Link,https://example.com,work|tools,https://example.com/thumb.jpg
```

### JSON import / export

The JSON format is the Better Bookmarks v1 exchange format. Use JSON for full-fidelity backups (includes encrypted thumbnails); use CSV for a lightweight human-readable export.

```json
{
  "version": 1,
  "exportedAt": "2024-01-01T00:00:00.000Z",
  "totalBookmarks": 42,
  "bookmarks": [
    {
      "title": "Example",
      "url": "https://example.com",
      "tags": ["work"],
      "thumbnail": { "type": "url", "value": "https://example.com/thumb.jpg" },
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

Binary thumbnails use `{ "type": "data", "value": "data:image/jpeg;base64,...", "originalName": "thumb.jpg" }`.

Import limits: max **100 MB** file size, max **5,000 bookmarks**.

---

## 🧰 Tech Stack

| Category             | Technology                                               |
| -------------------- | -------------------------------------------------------- |
| UI framework         | React 19                                                 |
| Language             | TypeScript 5                                             |
| Build tool           | Vite 8                                                   |
| Styling              | Tailwind CSS v4                                          |
| Component primitives | Radix UI (shadcn-style)                                  |
| Icons                | lucide-react                                             |
| Forms                | react-hook-form                                          |
| Animations           | Motion                                                   |
| Toasts               | Sonner                                                   |
| Drag and drop        | react-dnd                                                |
| Backend              | PostgREST + PostgreSQL                                   |
| Encryption           | Web Crypto API (AES-256-GCM, PBKDF2-SHA256, HMAC-SHA256) |
| Test runner          | Vitest 4                                                 |
| Testing utilities    | @testing-library/react, jsdom                            |
| CI                   | GitHub Actions                                           |

---

## 🤝 Contributing

Contributions are welcome! Please open an issue before submitting a pull request for significant changes. All pull requests must include tests for new behaviour and must pass CI (`npm test`).

## 📄 License

MIT
