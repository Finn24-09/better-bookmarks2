FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --ignore-scripts --omit=dev
COPY --from=builder /app/dist ./dist
# Run as the built-in non-root `node` user (uid 1000) shipped by the official
# node:22-alpine image. Combined with cap_drop ALL + read_only fs at the
# compose layer, this constrains a hypothetical RCE inside the service.
USER node
EXPOSE 5002
CMD ["node", "dist/index.js"]
