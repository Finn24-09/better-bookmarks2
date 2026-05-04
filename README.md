# 🔖 Better Bookmarks 2

> A self-hosted, end-to-end encrypted bookmark manager — your data never leaves your browser unencrypted.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org) [![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev) [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev) [![Tailwind](https://img.shields.io/badge/Tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com) [![Fastify](https://img.shields.io/badge/Fastify-5-000?logo=fastify&logoColor=white)](https://fastify.dev) [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)

<center>
<img src=./docs/DashboardPreview.png width=800px>
</center>

---

## ✨ Key Features

|     | Feature                           | Description                                                                                                                                 |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔐  | **End-to-end encryption**         | Title, URL, thumbnail, and tag names are AES-256-GCM encrypted in the browser before they ever reach the server                             |
| 🕵️  | **Zero-knowledge backend**        | The server only ever sees ciphertext — your encryption key never leaves your browser                                                        |
| 🔑  | **PBKDF2 key derivation**         | Your key is derived from password + email with 600,000 SHA-256 iterations; non-extractable and memory-only                                  |
| 📧  | **Email verification**            | New accounts ship with an email verification banner; one-tap resend with a 10-minute cooldown                                               |
| 🔁  | **Forgot-password flow**          | Email a 1-hour reset link — opening it permanently deletes all your data (your key is forgotten too) and lets you set a new password        |
| 🛡️  | **Email-confirmed deletion**      | Account deletion requires both an emailed token and your password, with a 3-second hold-to-confirm UI                                       |
| 🔔  | **Password-change notifications** | Best-effort email sent every time your password changes, so an unauthorised change is immediately visible                                   |
| ♻️  | **Resumable key rotation**        | Password changes re-encrypt every record under the new key; an interrupted rotation is detected on next login and finished by a recovery UI |
| 🚪  | **Server-side session kill**      | Each JWT carries a `tv` (token version) claim — password change or reset invalidates every live session in one DB write                     |
| 🏷️  | **Tag management**                | Multi-tag per bookmark with HMAC-based uniqueness — the DB enforces "no duplicate tag names" without ever seeing plaintext                  |
| 🔍  | **Real-time search**              | Debounced client-side search across title and URL, combined with tag filtering using AND logic                                              |
| 📥  | **Import**                        | CSV (RFC 4180, max 5 MB / 500 rows) and JSON (Better Bookmarks v1, max 100 MB / 5,000 bookmarks)                                            |
| 📤  | **Export**                        | JSON (full fidelity, encrypted thumbnails as base64 JPEG data URIs) and CSV; both cancellable via `AbortSignal`                             |
| 🖼️  | **Thumbnail upload**              | Images compressed to 480 × 270 px at JPEG 0.75 via Canvas API, then encrypted before upload                                                 |
| ♾️  | **Infinite scroll**               | Page size 20 via IntersectionObserver; switches to full load when search or tag filter is active                                            |
| 🚦  | **Rate limiting**                 | Per-IP zones for sign-in, sign-up, password change, exports, and every email endpoint — enforced at the edge by Nginx                       |
| 🔒  | **Hardened headers**              | HSTS, strict CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` — applied to every response                              |

---

## 🛡️ Security Model

Better Bookmarks 2 is built around a strict **zero-knowledge** architecture: the server stores only ciphertext, and only your browser ever holds the encryption key.

- 🔐 **Encryption key** — derived from `password + email` via PBKDF2-SHA256 (600,000 iterations). Marked non-extractable by the Web Crypto API and held only in memory. Cleared on logout; never written to `localStorage`, `sessionStorage`, or any cookie.
- 🎟️ **JWT** — kept exclusively in memory (`api.ts` module variable). Injected into request headers at call time and wiped on logout. The 24-hour expiry plus the per-request `tv` (token-version) check at PostgREST means a stolen token's blast radius is small _and_ revocable.
- 🔁 **Server-side session invalidation** — every JWT carries a `tv` claim; `auth.users.token_version` is incremented on `change_password` and on password reset. PostgREST's pre-request hook rejects any token whose `tv` no longer matches.
- 🏷️ **Tag uniqueness without plaintext** — `name_hmac = HMAC-SHA256(userId, tagName)` is stored alongside the encrypted name; the DB enforces `UNIQUE(user_id, name_hmac)` without ever seeing the plaintext.
- 🔑 **Password policy** — 12+ characters with at least one uppercase, one lowercase, and one non-letter. Enforced by the React forms _and_ by every SQL function that touches a password.
- 🔐 **bcrypt cost 13** — auth credentials use `gen_salt('bf', 13)` consistently in `sign_up`, `change_password`, and `reset_password_destroy_data`.
- 🚧 **API error sanitization** — only `/rpc/sign_in`, `/rpc/sign_up`, and `/rpc/change_password` relay raw PostgREST messages, and only on 400 / 409. Every other failure returns a hardcoded generic message to prevent schema leakage.
- 📧 **Isolated email service** — its DB role (`email_svc`) has only column-level SELECT on `auth.users` plus access to the auth-token tables. It cannot read a single bookmark, tag, or thumbnail.
- 🛡️ **Container hardening** — every service runs with `cap_drop: ALL` (db keeps the minimum it needs), `read_only: true` rootfs, explicit tmpfs mounts, and CPU/memory limits.
- 🚦 **Rate limiting** — Nginx `limit_req` zones bracket sign-in (5/min), sign-up (10/min), credential mutations (5/min), per-IP read traffic (60/min), and every email endpoint (2–10/min). Token query strings are scrubbed from access logs.

> ⚠️ **Forgot-password warning:** because your encryption key is derived from your password, a forgotten password makes existing ciphertext mathematically unrecoverable. The reset flow therefore **permanently deletes all of your bookmarks, tags, and thumbnails** before issuing a new password. Both the modal and the email warn about this in red.

---

## 📧 Email Service

Better Bookmarks 2 ships a small isolated **Fastify** microservice (`services/email/`) that handles every email-driven flow. It runs as its own Docker container, talks to PostgreSQL with a heavily restricted role, and never has access to encrypted user content.

The service speaks SMTP via `nodemailer` and is **AWS SES-aware**: setting `AWS_SES_CONFIGURATION_SET` adds the `X-SES-Configuration-Set` header automatically, and `AWS_SES_FROM_ARN` adds `X-SES-Source-ARN` for cross-account or delegated sending. Any standard SMTP relay (Postmark, Mailgun, your own Postfix, etc.) works without those.

---

## 🐳 Self-Hosting / Production Deployment

The recommended way to self-host Better Bookmarks 2 is with **Docker Compose**. The repository ships everything you need: a multi-stage `Dockerfile` for the frontend, an Nginx config with full security headers and rate limits, the email-service container, a hardened PostgreSQL image with the schema pre-applied, and a `docker-compose.yml` that wires it all together on an isolated bridge network.

**1. Clone the repository:**

```bash
git clone https://github.com/finn24-09/better-bookmarks2.git
cd better-bookmarks2
```

**2. Create your environment file** from the template:

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Group      | Variables                                                                      | Notes                                                                   |
| ---------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Postgres   | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`                            | See **Generating secrets** below — `POSTGRES_PASSWORD` must be URL-safe |
| JWT        | `PGRST_JWT_SECRET`                                                             | ≥ 32 chars                                                              |
| Email role | `EMAIL_DB_PASSWORD`                                                            | Restricted DB role; **must be URL-safe**                                |
| Cookies    | `COOKIE_SECRET`                                                                | ≥ 32 chars; signs the HttpOnly reset-token cookie                       |
| App URL    | `APP_BASE_URL`                                                                 | Public origin without trailing slash; must be `https://…` in production |
| SMTP       | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Works with AWS SES, Mailgun, Postmark, or any SMTP relay                |
| AWS SES    | `AWS_SES_REGION`, `AWS_SES_CONFIGURATION_SET`, `AWS_SES_FROM_ARN`              | Optional — leave blank for non-SES providers                            |

#### Generating secrets

`POSTGRES_PASSWORD` and `EMAIL_DB_PASSWORD` are interpolated by `docker-compose.yml` into PostgreSQL connection URIs (`postgres://user:password@host/db`). The base64 alphabet contains `/`, `+`, and `=`, which are reserved characters in URIs — a base64 password silently breaks the connection-string parser, the email service then sits with `dbHealth.ok = false` and `/health` returns 503 forever. **Use a hex-only generator for these two values:**

| Variable            | URL-embedded? | Generator command         | Why                                           |
| ------------------- | ------------- | ------------------------- | --------------------------------------------- |
| `POSTGRES_PASSWORD` | ✅ Yes        | `openssl rand -hex 32`    | 256 bits of entropy, alphabet `[0-9a-f]` only |
| `EMAIL_DB_PASSWORD` | ✅ Yes        | `openssl rand -hex 32`    | Same                                          |
| `PGRST_JWT_SECRET`  | ❌ No         | `openssl rand -base64 48` | 384 bits, base64 chars are fine in env vars   |
| `COOKIE_SECRET`     | ❌ No         | `openssl rand -base64 48` | Same                                          |

**3. Start the full stack** in production mode:

```bash
docker compose -f docker-compose.yml up -d
```

> The `-f docker-compose.yml` flag is required to skip `docker-compose.override.yml`, which contains development-only port forwards.

The app is available at **http://localhost:80** once the containers are healthy. 🎉

The stack runs four containers on an isolated bridge network:

| Container         | Role                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| **frontend**      | Nginx — serves the built React app, applies security headers + rate limits, proxies `/api/*`         |
| **postgrest**     | PostgREST v12 — exposes the `api` schema; pre-request hook validates `tv` claim                      |
| **email-service** | Fastify + Node 22 — token issuance / redemption, SMTP delivery; isolated DB role                     |
| **db**            | PostgreSQL 16 — schema, RLS policies, and SECURITY DEFINER auth helpers pre-applied via init scripts |

PostgreSQL data is persisted in a named Docker volume. PostgREST and the email service are **never exposed publicly** — only the frontend listens on port 80.

> 🌐 Run the stack behind a reverse proxy that terminates TLS in production. The Nginx config already emits HSTS, so it expects to be served over HTTPS on its public hostname.

---

## 💻 Local Development

**Prerequisites:**

- Node.js 20+
- Docker (recommended) **or** an existing PostgreSQL + PostgREST setup on `localhost:3000`
- An SMTP account if you want to exercise email flows locally — otherwise email errors will appear in the email-service logs but won't break the app

**1.** Bring the backend up:

```bash
docker compose up -d        # uses docker-compose.override.yml — exposes ports for the Vite proxy
```

This exposes PostgREST on `:3000` and the email service on `:5001` so the Vite dev proxy can reach them.

**2.** Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Vite proxies `/api/*` → `http://localhost:3000` (PostgREST) and `/api/email/*` → `http://localhost:5001` (email service).

**3.** Open **http://localhost:5173**.

### Dev commands

```bash
npm run dev          # Vite dev server at http://localhost:5173
npm test             # single-run Vitest (used in CI)
npm run test:watch   # watch mode for TDD
npm run build        # production build to dist/
```

### Test-driven development

This project is developed test-first. Every test file mirrors the source tree with a `.test.ts` / `.test.tsx` suffix. Write a failing test before implementing any feature or bugfix; run `npm test` and confirm it fails for the right reason; then make it pass.

### Database tests

The compose override defines a `test` service that runs SQL-level tests against the live DB:

```bash
docker compose --profile test run --rm test
```

### Continuous integration

GitHub Actions runs on every push and pull request to `main`:

1. **Security audit** — `npm audit --audit-level=moderate` blocks any dependency with a moderate-or-higher CVE (also gates Dependabot PRs).
2. **Test & build** — `npm ci && npm test && npm run build`.

A green CI badge means both jobs passed.

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

The parser is RFC 4180 compliant, dependency-free, and validates every URL with the WHATWG `URL` constructor.

### JSON import / export

JSON is the **Better Bookmarks v1** exchange format. Use it for full-fidelity backups (encrypted thumbnails are included as base64 JPEG data URIs); use CSV for a lightweight, human-readable export.

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

Binary thumbnails use `{ "type": "data", "value": "data:image/jpeg;base64,...", "originalName": "thumb.jpg" }`. JPEG magic bytes (`FF D8 FF`) are validated on import _and_ on export before embedding.

Import limits: max **100 MB** file size, max **5,000 bookmarks**. Export pipeline: 100 bookmarks per page, thumbnail concurrency capped at 3, cancellable via `AbortSignal`.

---

## 🧰 Tech Stack

| Category             | Technology                                               |
| -------------------- | -------------------------------------------------------- |
| UI framework         | React 19                                                 |
| Language             | TypeScript 5                                             |
| Build tool           | Vite 8                                                   |
| Styling              | Tailwind CSS v4 (via `@tailwindcss/vite`)                |
| Component primitives | Radix UI (shadcn-style)                                  |
| Icons                | lucide-react                                             |
| Forms                | react-hook-form                                          |
| Animations           | Motion                                                   |
| Toasts               | Sonner                                                   |
| Drag and drop        | react-dnd                                                |
| Routing              | React Router v7                                          |
| API gateway          | PostgREST v12 + PostgreSQL 16                            |
| Email service        | Fastify 5 + nodemailer + jose + zod (Node 22)            |
| Encryption           | Web Crypto API (AES-256-GCM, PBKDF2-SHA256, HMAC-SHA256) |
| Test runner          | Vitest 4 (frontend) / Vitest 3 (email service)           |
| Testing utilities    | @testing-library/react, jsdom                            |
| Reverse proxy        | Nginx (Alpine)                                           |
| CI                   | GitHub Actions + Dependabot                              |

---

## 🤝 Contributing

Contributions are welcome! Please open an issue before submitting a pull request for significant changes. All pull requests must include tests for new behaviour and must pass CI (`npm audit`, `npm test`, `npm run build`).

## 📄 License

MIT
