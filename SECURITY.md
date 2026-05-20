# 🛡️ Security Policy

Thank you for taking the time to help keep Better Bookmarks 2 and its users safe. This document describes how to report a vulnerability, what is in scope, and what you can expect from us in return.

---

## 📦 Supported Versions

Better Bookmarks 2 is a self-hosted application. Security fixes land on the `main` branch and are tagged in the next release. Only the most recent tagged release receives active security maintenance.

| Version       | Supported           |
| ------------- | ------------------- |
| `main` (HEAD) | ✅ Yes              |
| Latest tag    | ✅ Yes              |
| Older tags    | ❌ Please upgrade   |

If you operate an older deployment, please upgrade before submitting a report — the issue may already be fixed upstream.

---

## 📬 Reporting a Vulnerability

> [!IMPORTANT]
> Please do not open a public GitHub issue, pull request, discussion, or social-media post for security vulnerabilities. Public disclosure before a fix is shipped puts every self-hosted instance at risk.

### 🔐 Use GitHub Private Vulnerability Reporting

The only supported channel is GitHub's built-in private reporting:

1. 🌐 Go to the [Security tab](https://github.com/Finn24-09/better-bookmarks2/security/advisories/new) of this repository.
2. ✍️ Click **Report a vulnerability**.
3. 📝 Fill out the advisory form. Drafts are private to you and the maintainers.

This automatically opens a private advisory that only project maintainers can see and lets us coordinate a fix, CVE assignment (if applicable), and release notes from one place.

### 📋 What to Include

A good report contains:

- 🧩 **Affected component** — frontend, email service, metadata-fetcher, database schema, Docker / Nginx config, CI workflow, etc.
- 🔖 **Affected version or commit SHA** — `git rev-parse HEAD` of the deployment you tested.
- 💥 **Impact** — what an attacker can do (read other users' bookmarks, hijack sessions, exfiltrate the JWT secret, bypass rate limits, etc.).
- 🔁 **Reproduction steps** — minimal proof-of-concept. Curl commands, a short script, or a video are all fine. The simpler the repro, the faster we can fix it.
- 💡 **Suggested fix** — optional, but always welcome.
- 🗓️ **Disclosure preferences** — whether you want public credit in the advisory, and any disclosure timeline you need (e.g. an upcoming talk).

🚨 Reports that affect the cryptographic envelope (key derivation, AES-GCM usage, HMAC tag dedup, JWT verification, password reset key rotation) are the highest priority — please flag those clearly.

---

## ⏰ What to Expect

| Stage                 | Target time (business days) |
| --------------------- | --------------------------- |
| 📨 Acknowledge receipt   | within **2 days**           |
| 🔎 Initial triage + severity assessment | within **7 days** |
| 🛠️ Fix or mitigation plan | within **30 days** for High / Critical findings |
| 📢 Public advisory + release | as soon as a fix is available and any coordinated-disclosure date has passed |

These are targets, not hard SLAs — this is an open-source project maintained on a best-effort basis. We will communicate honestly if a fix needs longer.

We will keep you informed at each stage and credit you in the published advisory unless you ask us not to.

---

## 🎯 Scope

### ✅ In scope

Anything in this repository that ships in a production deployment:

- 🖥️ The React frontend (`src/`)
- 📧 The email microservice (`services/email/`)
- 🔗 The metadata-fetcher microservice (`services/metadata-fetcher/`)
- 🗄️ The PostgreSQL schema, RLS policies, and SECURITY DEFINER functions (`docker/db/init/`)
- 🌐 The Nginx reverse-proxy configuration (`docker/frontend/`)
- 🐳 The Docker Compose topology, network segmentation, and capability-drop posture
- ⚙️ GitHub Actions workflows in `.github/workflows/`

Examples of bugs we consider security-relevant:

- 🔓 Bypass of Row-Level Security or RLS user-isolation invariants
- 🎟️ JWT forgery, replay, or session-fixation that bypasses `token_version` revocation
- 🌐 Server-side request forgery (SSRF) against the metadata-fetcher, including DNS-rebinding and IPv6 dual-path bypasses
- 🔐 Plaintext leakage of encrypted fields (`title_enc`, `url_enc`, `name_enc`, thumbnails)
- 📝 Plaintext leakage in logs (bearer tokens, reset tokens, query strings)
- 🪛 Weakening of the password hash (bcrypt cost) or key derivation (PBKDF2 iterations)
- 🚦 Rate-limit bypasses that materially enable abuse (credential stuffing, mass email)
- 📦 Vulnerabilities in third-party dependencies that have a realistic exploitation path in this deployment

### 🚫 Out of scope

- 🧪 Self-hosted deployments running with `.env.example` placeholder values, a missing TLS terminator, or otherwise misconfigured infrastructure
- 🔑 Issues that require the attacker to already have administrative access to the host, container runtime, or database
- 🎓 Theoretical issues without a demonstrable impact (e.g. "the JWT is HS256 instead of EdDSA")
- 🌊 Denial of service via volumetric network flooding or by simply exhausting database connections (the application already enforces rate limits and Postgres-level limits; non-trivial amplification or asymmetric-cost attacks **are** in scope)
- 🎭 Social-engineering, physical attacks, and attacks that depend on a malicious browser extension running as the victim
- 🤖 Reports generated solely by automated scanners with no analysis (please include a written impact assessment)
- 🌳 Findings in unrelated upstream projects — please report those to the upstream maintainers

---

## 🤝 Safe Harbor

We will not pursue legal action against researchers who:

1. ✅ Make a good-faith effort to follow this policy.
2. 🚷 Do not access, modify, or delete data belonging to other users beyond what is required to demonstrate the issue.
3. 🪪 Do not perform tests against deployments they do not own or have explicit written permission to test.
4. ⏳ Give us a reasonable amount of time to remediate before any public disclosure (we will agree a date with you in writing).
5. 🧊 Do not exploit a finding for any purpose other than verifying its existence.

If you are unsure whether a planned test falls within this safe-harbor scope, ask us first via the channels above — we are happy to discuss.

---

## 🔄 Coordinated Disclosure

We follow a coordinated-disclosure model:

1. 🔐 You report privately via the channels above.
2. 🧰 We acknowledge, triage, and develop a fix on a private branch (or via a GitHub Security Advisory).
3. 📢 Once a fix is ready, we release it, publish the advisory, and credit you (unless you have asked to remain anonymous).
4. 🗓️ We request a **90-day embargo** between report and public disclosure for High / Critical findings, extendable by agreement for complex fixes. Lower-severity findings may be disclosed sooner.

💰 We do not currently offer a paid bug bounty. We will publicly thank you in the release notes and the GitHub Security Advisory, which is permanent and indexed by CVE search tools.

---

## 🧠 Security-Relevant Design

The README and the technical documentation (`docs/Technical Documentation.md`) describe the security model in detail — please read at least the relevant section before reporting. In particular:

- 🔒 The server is **zero-knowledge**: all sensitive fields are AES-256-GCM encrypted in the browser before transmission.
- 🔑 The encryption key is derived from `password + email` via PBKDF2-SHA256 (600,000 iterations) and is **never** persisted to disk or sent to the server.
- 🎟️ The JWT lives only in a module-level variable in the frontend; it is never written to `localStorage`, `sessionStorage`, or any cookie.
- 🔁 Each JWT carries a `tv` (token-version) claim; bumping `auth.users.token_version` invalidates every live session in one DB write.
- 🚷 The metadata-fetcher has no database role and runs on a dedicated egress-only Docker network with no L3 path to the database or PostgREST.
- 🛡️ Detailed SSRF hardening for the metadata-fetcher lives in `services/metadata-fetcher/src/ssrfGuard.ts` and is documented inline.

Reports that meaningfully break any of these invariants are exactly what we want to hear about.

---

💖 **Thank you again** for helping keep the project and its users safe.
