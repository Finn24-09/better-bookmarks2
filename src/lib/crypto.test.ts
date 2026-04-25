import { describe, it, expect } from 'vitest';
import { deriveKey, encrypt, decrypt, computeHmac, encryptBinary, decryptBinary } from './crypto';

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

  // -------------------------------------------------------------------------
  // encryptBinary / decryptBinary
  // -------------------------------------------------------------------------
  it('encryptBinary → decryptBinary round-trip returns the original bytes', async () => {
    const key = await deriveKey('password123', 'test@example.com');
    const original = new Uint8Array([1, 2, 3, 255, 0, 128, 64]);
    const encoded = await encryptBinary(key, original);
    const decoded = await decryptBinary(key, encoded);
    expect(decoded).toEqual(original);
  });

  it('encryptBinary produces a base64 string (not the raw bytes)', async () => {
    const key = await deriveKey('password123', 'test@example.com');
    const encoded = await encryptBinary(key, new Uint8Array([10, 20, 30]));
    expect(typeof encoded).toBe('string');
    // base64 characters only
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('encryptBinary with the same input produces different ciphertext each call (random IV)', async () => {
    const key = await deriveKey('password123', 'test@example.com');
    const data = new Uint8Array(32).fill(0xab);
    const enc1 = await encryptBinary(key, data);
    const enc2 = await encryptBinary(key, data);
    expect(enc1).not.toBe(enc2);
  });

  it('encryptBinary handles a large payload (>8 KB) without stack overflow', async () => {
    const key = await deriveKey('password123', 'test@example.com');
    // 100 KB of repeating data — exercises the chunked bytesToBase64 helper
    // (crypto.getRandomValues is capped at 64 KB, so we use fill instead)
    const large = new Uint8Array(100 * 1024).fill(0xab);
    const encoded = await encryptBinary(key, large);
    const decoded = await decryptBinary(key, encoded);
    expect(decoded).toEqual(large);
  });

  // -------------------------------------------------------------------------
  // encrypt — large string (F-4)
  // -------------------------------------------------------------------------
  it('encrypt handles a very long string without stack overflow', async () => {
    const key = await deriveKey('password123', 'test@example.com');
    // 70 000 chars → ciphertext > 65 535 bytes, which would blow the call stack
    // with the old btoa(String.fromCharCode(...spread)) approach.
    const long = 'x'.repeat(70_000);
    const encoded = await encrypt(key, long);
    const decoded = await decrypt(key, encoded);
    expect(decoded).toBe(long);
  });
});
