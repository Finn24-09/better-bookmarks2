import { describe, it, expect } from 'vitest';
import { generateToken, hashToken } from './tokenUtils.js';

describe('generateToken', () => {
  it('returns a string of at least 40 characters (base64url of 32 bytes)', () => {
    expect(generateToken().length).toBeGreaterThanOrEqual(40);
  });

  it('produces unique tokens on each call', () => {
    const tokens = Array.from({ length: 20 }, generateToken);
    const unique = new Set(tokens);
    expect(unique.size).toBe(20);
  });

  it('uses only URL-safe characters (no + / =)', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('hashToken', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const hash = hashToken('test-token');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic for the same input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });

  it('never returns the raw token value', () => {
    const raw = 'my-secret-token';
    expect(hashToken(raw)).not.toBe(raw);
  });
});
