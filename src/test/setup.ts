import '@testing-library/jest-dom';
import { webcrypto } from 'node:crypto';

// jsdom does not ship a SubtleCrypto implementation; use Node's built-in.
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
  writable: true,
});
