# 🤝 Contributing to Better Bookmarks 2

Thanks for considering a contribution. This guide is short on purpose — it covers the rules that are actually enforced by CI and review.

> [!IMPORTANT]
> If you are reporting a security vulnerability, **do not open a public issue**. Follow [SECURITY.md](SECURITY.md) instead.

---

## 📑 Table of Contents

- [✨ Ways to Contribute](#-ways-to-contribute)
- [🛠️ Development Setup](#️-development-setup)
- [🧪 Test-Driven Development (Required)](#-test-driven-development-required)
- [📝 Commit Style](#-commit-style)
- [🌿 Branch Naming](#-branch-naming)
- [✅ Pull Request Checklist](#-pull-request-checklist)
- [🔒 Security Invariants](#-security-invariants)
- [🎨 Code Style](#-code-style)
- [📚 Documentation Changes](#-documentation-changes)
- [🌟 Code of Conduct](#-code-of-conduct)

---

## ✨ Ways to Contribute

- 🐞 **Bug reports** — open an issue with a minimal reproduction. The bug-report issue template will prompt you for the right information.
- 💡 **Feature requests** — open an issue first. For anything non-trivial, please wait for maintainer feedback before starting implementation; this avoids wasted work if the design needs adjustment.
- 🔧 **Pull requests** — fixes, refactors, and documentation improvements are all welcome. Small, focused PRs land much faster than large ones.
- 🔐 **Security reports** — see [SECURITY.md](SECURITY.md).

If you are unsure whether a contribution will be accepted, open a draft issue and ask.

---

## 🛠️ Development Setup

The README has the full self-host story; this section covers the local-dev path.

```bash
git clone https://github.com/Finn24-09/better-bookmarks2.git
cd better-bookmarks2

# Bring the backend up (uses docker-compose.override.yml — exposes ports for Vite proxy)
docker compose up -d

# Frontend
npm install
npm run dev          # http://localhost:5173

# Email service (only if you are working on it)
cd services/email && npm install && npm run dev

# Metadata-fetcher service (only if you are working on it)
cd services/metadata-fetcher && npm install && npm run dev
```

You need **Node.js 22+** and **Docker**. An SMTP account is only required to exercise email flows end-to-end — without one, email errors land in the email-service logs but the app still works.

---

## 🧪 Test-Driven Development (Required)

This project is developed test-first. This is a hard rule, not a suggestion.

Before implementing any new feature or fixing any bug:

1. 🔴 Write a failing test that captures the expected behaviour.
2. 🟡 Run the relevant test command and confirm it fails for the right reason.
3. 🟢 Implement the minimum code to make it pass.
4. ✅ Run the tests again — everything must be green before you commit.

```bash
npm test                                              # frontend
cd services/email && npm test                         # email service
cd services/metadata-fetcher && npm test              # metadata-fetcher
```

Test files mirror the source tree:

| Source file                              | Test file                                     |
| ---------------------------------------- | --------------------------------------------- |
| `src/lib/foo.ts`                         | `src/lib/foo.test.ts`                         |
| `src/app/hooks/useBar.ts`                | `src/app/hooks/useBar.test.ts`                |
| `services/email/src/routes/foo.ts`       | `services/email/src/routes/foo.test.ts`       |
| `services/metadata-fetcher/src/foo.ts`   | `services/metadata-fetcher/src/foo.test.ts`   |

PRs that add behaviour without tests will be asked to add them. Security-relevant changes need tests that exercise the failure mode the change is preventing.

---

## 📝 Commit Style

One commit = one logical change. A commit should represent a single coherent intent and be reviewable on its own. If you change multiple unrelated things, split them into multiple commits.

```
<short summary in imperative mood — under 70 chars>

<body: one or more paragraphs explaining WHAT changed and WHY>
<reference issues / PRs / security advisories if relevant>
```

### 🎯 Summary line rules

- Imperative mood: `Fix RLS user_id leak`, not `Fixed` / `Fixes`.
- Use a meaningful prefix: `Fix`, `Add`, `Update`, `Refactor`, `Remove`, `Bump`, `Test`, `Document`.
- No trailing period; keep it under ~70 characters.

### 📄 Body rules

- Wrap at ~72 columns.
- Explain the *why* (motivation, root cause, threat model) — the diff already shows the *what*.
- Call out security-relevant impact, invariant changes, or breaking behaviour explicitly.
- For security/bug fixes, cite the failure mode you are preventing (e.g. "without this, the bearer JWT leaks into stdout via the request URL serializer").

Look at recent `git log` for examples of the project's voice.

### 🚫 Do not

- Bundle unrelated fixes ("fix bug + bump dep + rename file").
- Commit work-in-progress or half-implemented features.
- Commit generated files, `node_modules`, `.env`, secrets, or local IDE config.
- Use `git add -A` or `git add .` blindly — stage specific files.

---

## 🌿 Branch Naming

Use slash-namespaced, kebab-case branches off `main`:

- 🐞 `fix/<short-topic>` — bug fixes
- 🚀 `feat/<short-topic>` — new features
- 🧹 `chore/<short-topic>` — tooling, dependency bumps, non-functional cleanups
- 📚 `docs/<short-topic>` — documentation only

Never commit directly to `main`. Open a PR so CI runs and review is possible.

---

## ✅ Pull Request Checklist

Before requesting review, confirm:

- [ ] 🧪 You wrote a failing test first, then made it pass.
- [ ] 🟢 `npm test` is green in every package you touched.
- [ ] 🏗️ `npm run build` succeeds in every package you touched.
- [ ] 🛡️ `npm audit --audit-level=moderate` reports no findings.
- [ ] 🧼 `git diff --staged` contains no debug logging, secrets, `.env` fragments, or stray files.
- [ ] 📝 Commit messages follow the [Commit Style](#-commit-style) above.
- [ ] 📚 You updated docs (README, technical documentation, code comments) where behaviour changed.
- [ ] 🔒 If you touched a security-relevant path, you re-checked the [Security Invariants](#-security-invariants).
- [ ] 🐳 If you changed a `Dockerfile` or its build context, the PR-time `dockerfile-smoke-build` job for the affected image passes.

CI runs `npm audit`, `npm test`, and `npm run build` for all three packages (frontend, email, metadata-fetcher), plus a multi-arch `docker buildx build` smoke job for any Dockerfile whose context the PR touches. All jobs must pass before merge.

---

## 🔒 Security Invariants

These are the core of the zero-knowledge architecture. Regressions here are not acceptable. If your change might touch one of them, call it out in the PR description so reviewers can verify.

- 🔑 **Encryption key** lives only in memory (`AuthContext` state). It is never written to `localStorage`, `sessionStorage`, cookies, IndexedDB, or any log line.
- 🎟️ **JWT** lives only in a module-level variable in `src/lib/api.ts`. Same persistence rule.
- 🧮 **PBKDF2 parameters** are fixed (SHA-256, 600,000 iterations, non-extractable derived key). Do not lower them.
- 🔐 **Encrypted fields** (`title_enc`, `url_enc`, `name_enc`, `data_enc`, `thumbnail_url_enc`, `original_name_enc`) always pass through `encrypt(key, value)` / `decrypt(key, value)`. Never send plaintext.
- 🏷️ **HMAC tag deduplication** — `name_hmac = HMAC-SHA256(userId, tagName)` must be included on every tag create.
- 👤 **`user_id` in mutations** — always include `user_id` in POST bodies for `bookmarks`, `tags`, and `thumbnail_images`. RLS enforces ownership but PostgREST needs the column.
- ♻️ **Password change = key rotation.** Re-encrypt every record under the new key *before* calling the `change_password` RPC. The order matters.
- 🛡️ **API error sanitization** — only 400/401/409 may relay PostgREST messages; everything else returns a generic message.
- 📝 **Log redaction** — `LOG_REDACT_PATHS` (object paths) and the custom `reqSerializer` (URL query strings) must stay in sync in both `services/email/` and `services/metadata-fetcher/`.
- 🌐 **Metadata-fetcher SSRF posture** — the layered defence in `services/metadata-fetcher/src/ssrfGuard.ts` (hostname canonicalisation, IP deny-list, dial-by-IP DNS pinning, body cap, timeout, content-type allowlist, redirect re-resolution, closed-set outbound headers) is load-bearing. Do not weaken it.
- ✉️ **Verified-email gate on metadata-fetcher** — strict equality (`=== true`), not truthiness. Missing claim → 401; false / coerced shapes → 403.

See `CLAUDE.md` for the long-form rationale behind each invariant.

---

## 🎨 Code Style

- 🧷 **TypeScript** — prefer narrow types and discriminated unions over `any` / `unknown` casts. Type every exported symbol.
- ⚛️ **React** — use hooks idiomatically. No derived state stored in `useState` if it can be computed. Clean up every `useEffect` side-effect (timers, observers, object URLs).
- 🛂 **Backend** — validate every external input with a `zod` schema before acting on it. Use parameterised queries (`pg`'s `$1`, `$2` placeholders) — never string-concatenate SQL.
- 💬 **Comments** — explain the *why* (especially security invariants). The code already shows the *what*. Do not write trailing summaries inside files.
- 🚫 **No `console.log` in committed code.** Use Pino on the server and structured errors on the client (toast via Sonner for user-facing).
- 🪶 **Follow existing patterns.** Look at neighbouring code before inventing a new convention.

---

## 📚 Documentation Changes

Documentation-only PRs are welcome. If you update the README or technical docs:

- ✅ Verify any code references (file paths, function names, ports) against current `HEAD`.
- 🗣️ Keep the project's voice — concise, security-aware, and explicit about *why*, not just *what*.
- 🔗 The Tech Stack table in the README and the `ATTRIBUTIONS.md` list should not drift out of sync with `package.json` — update both when adding or removing a dependency.

---

## 🌟 Code of Conduct

This project has a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to follow it.

---

💖 Thanks again for contributing.
