import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // vitest 4 dropped `dist` from defaultExclude, so compiled `dist/*.test.js` would otherwise re-run every test.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  },
});
