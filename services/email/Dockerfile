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
RUN addgroup -g 1001 -S emailsvc && adduser -u 1001 -S emailsvc -G emailsvc
USER emailsvc
EXPOSE 5001
CMD ["node", "dist/index.js"]
