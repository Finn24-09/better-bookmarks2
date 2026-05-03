# syntax=docker/dockerfile:1

# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies first so this layer is cache-reused on source-only changes.
# `--ignore-scripts` blocks transitive postinstall/preinstall scripts from running
# inside the build container — the supply-chain blast radius for a compromised
# package is reduced to "import-time mischief", which Vite tree-shakes if unused.
# Vite, Tailwind v4, and React's deps do not require any postinstall to function. (SEC-024)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and produce the production bundle
COPY . .
RUN npm run build

# ─── Stage 2: serve ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
