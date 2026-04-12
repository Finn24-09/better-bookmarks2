import { describe, it, expect } from 'vitest';
import { deriveKey, encrypt, decrypt, computeHmac } from './crypto';

describe('crypto', () => {
  // -------------------------------------------------------------------------
  // encrypt / decrypt
  // -------------------------------------------------------------------------
  it('encrypt → decrypt round-trip returns the original string', async () => {
    const key = await deriveKey('password123', 'test@example.com');
    const plaintext = 'Hello, World!';
    const encoded = await encrypt(key, plaintext);
    const decoded = await decrypt(key, encoded);
    expect(decoded).toBe(plaintext);
  });

  it('same plaintext encrypted twice produces different ciphertext (random IV)', async () => {
    const key = await deriveKey('password123', 'test@example.com');
    const enc1 = await encrypt(key, 'same input');
    const enc2 = await encrypt(key, 'same input');
    expect(enc1).not.toBe(enc2);
  });

  it('ciphertext is not equal to the plaintext', async () => {
    const key = await deriveKey('password123', 'test@example.com');
    const plaintext = 'secret bookmark title';
    const encoded = await encrypt(key, plaintext);
    expect(encoded).not.toBe(plaintext);
  });

  // -------------------------------------------------------------------------
  // Non-extractable key
  // -------------------------------------------------------------------------
  it('deriveKey returns a non-extractable key (raw bytes cannot be exported)', async () => {
    const key = await deriveKey('password123', 'test@example.com');
    await expect(
      crypto.subtle.exportKey('raw', key),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // computeHmac
  // -------------------------------------------------------------------------
  it('computeHmac is deterministic for the same inputs', async () => {
    const h1 = await computeHmac('user-uuid-123', 'my-tag');
    const h2 = await computeHmac('user-uuid-123', 'my-tag');
    expect(h1).toBe(h2);
  });

  it('computeHmac produces different output for different tag names', async () => {
    const h1 = await computeHmac('user-uuid-123', 'tag-a');
    const h2 = await computeHmac('user-uuid-123', 'tag-b');
    expect(h1).not.toBe(h2);
  });

  it('computeHmac produces different output for different user IDs', async () => {
    const h1 = await computeHmac('user-a', 'same-tag');
    const h2 = await computeHmac('user-b', 'same-tag');
    expect(h1).not.toBe(h2);
  });
});
