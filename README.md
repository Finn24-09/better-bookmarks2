<div align="center">

# 🔖 Better Bookmarks 2

**A self-hosted, end-to-end encrypted bookmark manager.** ✨
Your data never leaves your browser unencrypted — the server only ever sees ciphertext.

<p>
  <a href="https://github.com/Finn24-09/better-bookmarks2/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Finn24-09/better-bookmarks2/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  <a href="CODE_OF_CONDUCT.md"><img alt="Code of Conduct" src="https://img.shields.io/badge/Code%20of%20Conduct-%F0%9F%8C%9F-4baaaa.svg"></a>
  <a href="SECURITY.md"><img alt="Security Policy" src="https://img.shields.io/badge/Security-Policy-blue.svg"></a>
</p>

<p>
  <img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D22-brightgreen?logo=node.js&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white">
  <img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white">
  <img alt="Tailwind v4" src="https://img.shields.io/badge/Tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white">
  <img alt="Fastify 5" src="https://img.shields.io/badge/Fastify-5-000?logo=fastify&logoColor=white">
  <img alt="PostgreSQL 16" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white">
  <img alt="PostgREST 12" src="https://img.shields.io/badge/PostgREST-12-1F2D3D">
  <img alt="Vitest 4" src="https://img.shields.io/badge/Vitest-4-6E9F18?logo=vitest&logoColor=white">
</p>

<br>

<img src="docs/DashboardPreview.png" alt="Better Bookmarks 2 dashboard preview" width="820">

<br><br>

<sub>
  <a href="#-why">✨ Why</a> · <a href="#-features">🎯 Features</a> · <a href="#-security-model">🔒 Security</a> · <a href="#-quick-start">🚀 Quick Start</a> · <a href="#-self-hosting">🐳 Self-Hosting</a> · <a href="#-local-development">💻 Development</a> · <a href="#-tech-stack">🧰 Tech Stack</a> · <a href="#-community">🤝 Community</a>
</sub>

</div>

---

## ✨ Why

Most self-hosted bookmark managers ask you to trust the server with the plaintext of every page you save. Better Bookmarks 2 inverts that contract: 🔒 the server stores only ciphertext, and the encryption key never leaves your browser.

You get a fast, modern dashboard for your links. The operator of the database — even if that operator is you — cannot read a single title, URL, tag, or thumbnail. 🎉

---

## 🎯 Features

<table>
<tr>
  <td>🔐 <strong>End-to-end encryption</strong></td>
  <td>AES-256-GCM in the browser before transmission. Server stores only ciphertext.</td>
</tr>
<tr>
  <td>🕵️ <strong>Zero-knowledge backend</strong></td>
  <td>The encryption key is derived from password + email via PBKDF2 (600k iterations, SHA-256). Never leaves the browser, never persisted.</td>
</tr>
<tr>
  <td>🚪 <strong>Server-side session kill</strong></td>
  <td>Each JWT carries a <code>tv</code> token-version claim. Password change or reset invalidates every live session in one DB write.</td>
</tr>
<tr>
  <td>🏷️ <strong>Tag dedup without plaintext</strong></td>
  <td><code>name_hmac = HMAC-SHA256(userId, tagName)</code> lets the DB enforce uniqueness without ever seeing the plaintext name.</td>
</tr>
<tr>
  <td>♻️ <strong>Resumable key rotation</strong></td>
  <td>Password changes re-encrypt every record under the new key. Interrupted rotations are detected on next login and finished by a recovery UI.</td>
</tr>
<tr>
  <td>📧 <strong>Email verification</strong></td>
  <td>One-tap resend with a 10-minute cooldown, banner-driven UX, and a dedicated route that mints a fresh JWT after verification so the metadata-fetcher gate immediately accepts the new claim.</td>
</tr>
<tr>
  <td>🔁 <strong>Forgot-password flow</strong></td>
  <td>One-hour reset link; opening it permanently deletes existing ciphertext (your key is gone) and lets you set a fresh password.</td>
</tr>
<tr>
  <td>🛡️ <strong>Email-confirmed deletion</strong></td>
  <td>Account deletion needs both an emailed token AND your password, with a 3-second hold-to-confirm UI.</td>
</tr>
<tr>
  <td>🔔 <strong>Password-change notifications</strong></td>
  <td>Best-effort email sent on every password change — an unauthorised change is immediately visible to the account owner.</td>
</tr>
<tr>
  <td>🌐 <strong>Hardened metadata-fetcher</strong></td>
  <td>Server-side <code>&lt;title&gt;</code> extraction for auto-fill. Stateless, network-isolated, with layered SSRF defence (IP deny-list, DNS pinning, body cap, redirect re-resolution, closed-set outbound headers).</td>
</tr>
<tr>
  <td>🔍 <strong>Real-time search & tags</strong></td>
  <td>Debounced client-side search across title and URL, combined with tag filtering using AND logic. Multi-tag per bookmark.</td>
</tr>
<tr>
  <td>📥 <strong>Import / Export</strong></td>
  <td>CSV (RFC 4180, dependency-free parser) and JSON (Better Bookmarks v1 format, full-fidelity backups). Both cancellable via <code>AbortSignal</code>.</td>
</tr>
<tr>
  <td>🖼️ <strong>Thumbnails</strong></td>
  <td>Compressed to 480 × 270 px JPEG at quality 0.75 via Canvas API, then encrypted before upload.</td>
</tr>
<tr>
  <td>♾️ <strong>Infinite scroll</strong></td>
  <td>Page-size 20 via IntersectionObserver. Switches to full client-side filter when search or tag filter is active.</td>
</tr>
<tr>
  <td>🚦 <strong>Rate limiting</strong></td>
  <td>Per-IP zones for sign-in, sign-up, password change, exports, and every email / metadata endpoint — enforced at the edge by Nginx, with per-route limits in the Fastify services as defence in depth.</td>
</tr>
<tr>
  <td>🔒 <strong>Hardened headers</strong></td>
  <td>HSTS, strict CSP, <code>X-Frame-Options: DENY</code>, <code>Referrer-Policy</code>, <code>Permissions-Policy</code> on every response.</td>
</tr>
</table>

<details>
<summary>🐳 <strong>Container security posture</strong></summary>

Every service container runs with `cap_drop: ALL` (the database keeps the minimum capabilities Postgres needs), a `read_only: true` root filesystem with explicit tmpfs mounts for writable paths, and explicit CPU / memory limits. The metadata-fetcher additionally runs on a dedicated egress-only Docker network with no L3 path to the database or PostgREST — an SSRF or CVE inside the fetcher cannot reach user data.

</details>

---

## 🏗️ Architecture

```
                         ┌────────────────────────────────┐
   Browser  ─────────►   │  frontend  (nginx :80)         │
                         │  static SPA + security headers │
                         │  rate limits + /api/* proxy    │
                         └──┬──────────────┬─────────────┬┘
                            │              │             │
                            ▼              ▼             ▼
        ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
        │ postgrest  :3000   │  │ email-service      │  │ metadata-fetcher   │
        │ schema = api       │  │ Fastify + jose     │  │ Fastify + jose     │
        │ JWT verify         │  │ scoped DB role     │  │ NO DB role         │
        │ pre-request hook   │  │ SMTP + tokens      │  │ SSRF-hardened      │
        └─────────┬──────────┘  └─────────┬──────────┘  └────────────────────┘
                  │                       │
                  └───────────┬───────────┘
                              ▼
                 ┌────────────────────────┐
                 │ postgres  :5432        │
                 │ schemas: auth + api    │
                 │ RLS on every api.*     │
                 └────────────────────────┘
```

🧱 Five containers on two Docker networks. Only the frontend listens on a host port. The metadata-fetcher has no database role and lives on a dedicated `metadata_net` network so an SSRF or CVE inside its HTTP / parser stack cannot reach the database.

📖 See [docs/Technical Documentation.md](docs/Technical%20Documentation.md) for the deep dive.

---

## 🔒 Security Model

Better Bookmarks 2 is built around a strict **zero-knowledge** architecture.

- 🔑 **Encryption key** — derived from `password + email` via PBKDF2-SHA256 (600,000 iterations). Marked non-extractable by the Web Crypto API. Held only in memory. Cleared on logout. Never written to `localStorage`, `sessionStorage`, IndexedDB, or any cookie.
- 🎟️ **JWT** — kept exclusively in memory (a module-level variable in `src/lib/api.ts`). Injected into request headers at call time and wiped on logout. The 24-hour expiry plus the per-request `tv` (token-version) check at PostgREST means a stolen token has a small _and_ revocable blast radius.
- 🔁 **Server-side session invalidation** — every JWT carries a `tv` claim. `auth.users.token_version` is incremented on `change_password` and on password reset. PostgREST's pre-request hook rejects any token whose `tv` no longer matches.
- 🏷️ **Tag uniqueness without plaintext** — `name_hmac = HMAC-SHA256(userId, tagName)` is stored next to the encrypted name. The DB enforces `UNIQUE(user_id, name_hmac)` without ever seeing the plaintext.
- 🔐 **Password policy** — 12+ characters, at least one uppercase, one lowercase, and one non-letter. Enforced by the React forms _and_ by every SQL function that touches a password.
- 🧂 **bcrypt cost 13** — auth credentials use `gen_salt('bf', 13)` consistently across `sign_up`, `change_password`, and `reset_password_destroy_data`.
- 🚧 **API error sanitization** — only `sign_in`, `sign_up`, and `change_password` relay raw PostgREST messages, and only on 400 / 409. Every other failure returns a hardcoded generic message to prevent schema leakage.
- 📮 **Isolated email service** — the `email_svc` DB role has only column-level SELECT on `auth.users` plus the auth-token tables. It cannot read a single bookmark, tag, or thumbnail.
- 🌐 **Metadata-fetcher SSRF posture** — layered defence in [`services/metadata-fetcher/src/ssrfGuard.ts`](services/metadata-fetcher/src/ssrfGuard.ts): hostname canonicalisation, IP deny-list (incl. cloud-metadata endpoints), dial-by-IP DNS pinning to defeat rebind, body cap, 5-second timeout, content-type allowlist, gzip rejection, redirect re-resolution, HTTPS-downgrade rejection, closed-set outbound headers. The container is on `metadata_net` with no L3 path to `db` or `postgrest`.
- ✉️ **Verified-email gate on metadata-fetcher** — strict `email_verified === true` claim required before serving `POST /title`. Missing claim → 401. Coerced or false → 403 with a byte-identical body to prevent account enumeration.
- 🚦 **Rate limiting** — Nginx `limit_req` zones bracket sign-in (5/min), sign-up (10/min), credential mutations (5/min), per-IP read traffic (60/min), and every email / metadata endpoint (2–10/min). Token query strings are scrubbed from access logs.

> [!WARNING]
> **Forgot-password flow:** because the encryption key is derived from your password, a forgotten password makes existing ciphertext mathematically unrecoverable. The reset flow therefore **permanently deletes all of your bookmarks, tags, and thumbnails** before issuing a new password. Both the modal and the reset email warn about this in red.

🛡️ For the full vulnerability disclosure policy, see [SECURITY.md](SECURITY.md).

---

## 🧩 Microservices

Two small Fastify-based microservices sit alongside PostgREST:

### 📧 Email service (`services/email/`)

Handles password reset, email verification, account deletion, and password-change notifications. Runs as its own container with a heavily scoped DB role (`email_svc`) that cannot read encrypted user content. Speaks SMTP via `nodemailer`. **AWS SES-aware**: set `AWS_SES_CONFIGURATION_SET` to add `X-SES-Configuration-Set` automatically, and `AWS_SES_FROM_ARN` for cross-account or delegated sending. Any standard SMTP relay (Postmark, Mailgun, your own Postfix, etc.) works without those.

### 🌐 Metadata-fetcher (`services/metadata-fetcher/`)

Stateless server-side `<title>` extraction for the Add Bookmark auto-fill button. **Has no database role.** Lives on a dedicated `metadata_net` Docker network with no L3 path to the database or PostgREST — an SSRF bypass or CVE inside its parser stack cannot reach user data. The frontend treats auto-fill as non-essential — every failure mode leaves the form fully usable for manual entry. The full SSRF / DoS / log-leakage hardening surface is documented inline in [`services/metadata-fetcher/src/ssrfGuard.ts`](services/metadata-fetcher/src/ssrfGuard.ts).

---

## 🚀 Quick Start

```bash
git clone https://github.com/Finn24-09/better-bookmarks2.git
cd better-bookmarks2
cp .env.example .env        # fill in the values — see Self-Hosting below
docker compose -f docker-compose.yml up -d
```

🎉 Open **http://localhost:80** once the containers are healthy.

The `-f docker-compose.yml` flag is required to skip `docker-compose.override.yml`, which contains development-only port forwards.

---

## 🐳 Self-Hosting

The recommended way to self-host is with **Docker Compose**. The repository ships everything you need: a multi-stage `Dockerfile` for the frontend, an Nginx config with full security headers and rate limits, both Fastify microservices, a hardened PostgreSQL image with the schema pre-applied, and a `docker-compose.yml` that wires it all together on isolated bridge networks.

### 1️⃣ Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Group         | Variables                                                                      | Notes                                                                   |
| ------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 🗄️ Postgres   | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`                            | See **Generating secrets** below — `POSTGRES_PASSWORD` must be URL-safe |
| 🎟️ JWT        | `PGRST_JWT_SECRET`                                                             | ≥ 32 chars                                                              |
| 📮 Email role | `EMAIL_DB_PASSWORD`                                                            | Restricted DB role; **must be URL-safe**                                |
| 🍪 Cookies    | `COOKIE_SECRET`                                                                | ≥ 32 chars; signs the HttpOnly reset-token cookie                       |
| 🌍 App URL    | `APP_BASE_URL`                                                                 | Public origin without trailing slash; must be `https://…` in production |
| ✉️ SMTP       | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Works with AWS SES, Mailgun, Postmark, or any SMTP relay                |
| ☁️ AWS SES    | `AWS_SES_REGION`, `AWS_SES_CONFIGURATION_SET`, `AWS_SES_FROM_ARN`              | Optional — leave blank for non-SES providers                            |

#### 🔐 Generating secrets

`POSTGRES_PASSWORD` and `EMAIL_DB_PASSWORD` are interpolated by `docker-compose.yml` into PostgreSQL connection URIs (`postgres://user:password@host/db`). The base64 alphabet contains `/`, `+`, and `=` — reserved characters in URIs — so a base64 password silently breaks the connection-string parser, the email service then sits with `dbHealth.ok = false`, and `/health` returns 503 forever. **Use a hex-only generator for these two values:**

| Variable            | URL-embedded? | Generator command         | Why                                           |
| ------------------- | ------------- | ------------------------- | --------------------------------------------- |
| `POSTGRES_PASSWORD` | ✅ Yes        | `openssl rand -hex 32`    | 256 bits of entropy, alphabet `[0-9a-f]` only |
| `EMAIL_DB_PASSWORD` | ✅ Yes        | `openssl rand -hex 32`    | Same                                          |
| `PGRST_JWT_SECRET`  | ❌ No         | `openssl rand -base64 48` | 384 bits, base64 chars are fine in env vars   |
| `COOKIE_SECRET`     | ❌ No         | `openssl rand -base64 48` | Same                                          |

### 2️⃣ Start the stack

```bash
docker compose -f docker-compose.yml up -d
```

🎉 The app is available at **http://localhost:80** once the containers are healthy.

### 3️⃣ Container topology

| Container               | Role                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| 🌐 **frontend**         | Nginx — serves the built React app, applies security headers + rate limits, proxies `/api/*`         |
| 🛢️ **postgrest**        | PostgREST v12 — exposes the `api` schema; pre-request hook validates the JWT `tv` claim              |
| 📧 **email-service**    | Fastify + Node 22 — token issuance / redemption, SMTP delivery; scoped `email_svc` DB role           |
| 🔗 **metadata-fetcher** | Fastify + Node 22 — stateless server-side `<title>` extraction; SSRF-hardened, no DB role            |
| 🗄️ **db**               | PostgreSQL 16 — schema, RLS policies, and SECURITY DEFINER auth helpers pre-applied via init scripts |

🔒 PostgreSQL data is persisted in a named Docker volume. PostgREST, the email service, and the metadata-fetcher are **never exposed publicly** — only the frontend listens on port 80.

> [!NOTE]
> Run the stack behind a reverse proxy that terminates TLS in production. The Nginx config already emits HSTS, so it expects to be served over HTTPS on its public hostname.

---

## 💻 Local Development

### 📋 Prerequisites

- 🟢 **Node.js 22+** (the CI matrix runs on 22)
- 🐳 **Docker** (recommended) **or** an existing PostgreSQL + PostgREST setup on `localhost:3000`
- ✉️ An SMTP account if you want to exercise email flows end-to-end — otherwise email errors land in the email-service logs but the app still works

### ⚙️ Setup

```bash
# 1. Bring up the backend (uses docker-compose.override.yml — exposes ports for Vite proxy)
docker compose up -d

# 2. Install and start the frontend dev server
npm install
npm run dev
```

Vite proxies:

- 🛢️ `/api/*` → `http://localhost:3000` (PostgREST)
- 📧 `/api/email/*` → `http://localhost:5001` (email service)
- 🔗 `/api/title/*` → `http://localhost:5002` (metadata-fetcher)

Open **http://localhost:5173**.

### 🧰 Dev commands

```bash
npm run dev          # Vite dev server at http://localhost:5173
npm test             # single-run Vitest (used in CI)
npm run test:watch   # watch mode for TDD
npm run build        # production build to dist/

# Microservices (each has the same commands)
cd services/email           && npm test
cd services/metadata-fetcher && npm test
```

### 🧪 Test-driven development

This project is developed test-first. Every test file mirrors the source tree with a `.test.ts` / `.test.tsx` suffix. Write a failing test before implementing any feature or bugfix; run `npm test` and confirm it fails for the right reason; then make it pass. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full rules.

### 🗄️ Database tests

The compose override defines a `test` service that runs SQL-level tests against the live database:

```bash
docker compose --profile test run --rm test
```

### 🤖 Continuous integration

GitHub Actions runs six jobs on every push and pull request to `main`:

1. 🛡️ `webapp-security-audit` — `npm audit --audit-level=moderate` (frontend)
2. 🏗️ `webapp-test-and-build` — `npm ci && npm test && npm run build`
3. 📧 `email-security-audit` + `email-test-and-build`
4. 🔗 `metadata-fetcher-security-audit` + `metadata-fetcher-test-and-build`

A green CI badge at the top of this README means every job passed on `main`. Dependabot patches and minor updates are bundled weekly; React, Vite, and Tailwind majors get isolated PRs for careful review.

---

## 📥 Import / Export

### 📄 CSV import

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

The parser is RFC 4180-compliant, dependency-free, and validates every URL with the WHATWG `URL` constructor.

### 📦 JSON import / export

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

| Category                | Technology                                                   |
| ----------------------- | ------------------------------------------------------------ |
| 🖼️ UI framework         | React 19                                                     |
| 📘 Language             | TypeScript 5                                                 |
| ⚡ Build tool           | Vite 8                                                       |
| 🎨 Styling              | Tailwind CSS v4 (via `@tailwindcss/vite`)                    |
| 🧩 Component primitives | Radix UI (shadcn-style)                                      |
| ✨ Icons                | lucide-react                                                 |
| 📝 Forms                | react-hook-form                                              |
| 🎬 Animations           | Motion                                                       |
| 🔔 Toasts               | Sonner                                                       |
| 🖱️ Drag and drop        | react-dnd                                                    |
| 🧭 Routing              | React Router v7                                              |
| 🛢️ API gateway          | PostgREST v12 + PostgreSQL 16                                |
| 📧 Email service        | Fastify 5 + nodemailer + jose + zod (Node 22)                |
| 🔗 Metadata-fetcher     | Fastify 5 + htmlparser2 + jose + zod + prom-client (Node 22) |
| 🔐 Encryption           | Web Crypto API (AES-256-GCM, PBKDF2-SHA256, HMAC-SHA256)     |
| 🧪 Test runner          | Vitest 4 (all three packages)                                |
| 🧰 Testing utilities    | @testing-library/react, jsdom                                |
| 🌐 Reverse proxy        | Nginx (Alpine)                                               |
| 🤖 CI                   | GitHub Actions + Dependabot                                  |

The full list of direct dependencies, with licenses, is in [ATTRIBUTIONS.md](ATTRIBUTIONS.md).

---

## 📚 Documentation

- 📘 **[Technical Documentation](docs/Technical%20Documentation.md)** — deep dive on architecture, security model, RLS / RPCs, session invalidation, key rotation, SSRF defence, and operations.
- 🤝 **[CONTRIBUTING.md](CONTRIBUTING.md)** — TDD policy, commit style, branch naming, security-invariant checklist.
- 🛡️ **[SECURITY.md](SECURITY.md)** — vulnerability disclosure policy and scope.
- 🌟 **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** — what we expect from everyone participating in project spaces.
- 📦 **[ATTRIBUTIONS.md](ATTRIBUTIONS.md)** — direct dependency licenses across all three packages and the infrastructure layer.

---

## 🤝 Community

- 🐞 **Issues** — bug reports and feature requests welcome. Templates will guide you through what to include. Please search existing issues first.
- 💬 **Discussions** — for deployment help, design questions, and open-ended conversation.
- 🔐 **Security reports** — **never** in a public issue. See [SECURITY.md](SECURITY.md) for the private-disclosure channel.
- 🔧 **Pull requests** — please read [CONTRIBUTING.md](CONTRIBUTING.md) first. TDD is non-negotiable; small, focused PRs land faster.

By participating in this project's spaces you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). 🌟

---

## 📄 License

Released under the [MIT License](LICENSE). © 2026 Finn24-09.
