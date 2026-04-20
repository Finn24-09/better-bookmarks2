# syntax=docker/dockerfile:1

# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies first so this layer is cache-reused on source-only changes
COPY package.json package-lock.json ./
RUN npm ci --frozen-lockfile

# Copy source and produce the production bundle
COPY . .
RUN npm run build

# ─── Stage 2: serve ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
