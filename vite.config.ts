/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  server: {
    proxy: {
      // Email service — must appear before the general /api rule.
      // In dev, the email service exposes port 5001 on localhost (127.0.0.1:5001:5001).
      // In production, Nginx routes /api/email/* internally; port 5001 is not public.
      '/api/email': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/email/, ''),
      },
      // Metadata-fetcher service — exact-match route, must precede /api below.
      // In dev, exposed on port 5002 via docker-compose.override.yml.
      // Rewrite normalises both /api/title and /api/title/ to /title so dev
      // matches production Nginx's `proxy_pass http://upstream/title;`
      // behaviour exactly — the service's only route is POST /title and a
      // trailing slash in the inbound URL would otherwise 404 the request.
      //
      // Adding a future endpoint under /api/title/ (favicon, preview, …)
      // requires three coordinated edits: a new exact-match `location`
      // block in docker/frontend/nginx.conf above the `^~ /api/title/`
      // deny-wildcard, a new rewrite entry here (or an allow-list
      // broadening of the regex), and the corresponding Fastify route.
      '/api/title': {
        target: 'http://localhost:5002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/title\/?$/, '/title'),
      },
      // Proxy /api/* → PostgREST at :3000 (strips the /api prefix)
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },

  build: {
    sourcemap: false,
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
