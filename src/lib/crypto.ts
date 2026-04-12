const PBKDF2_ITERATIONS = 210_000;

/** Derive a 256-bit AES-GCM key from password + email via PBKDF2-SHA-256. */
export async function deriveKey(password: string, email: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(email.toLowerCase()),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: key bytes never leave the Web Crypto engine
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt plaintext. Returns base64(iv || ciphertext). */
export async function encrypt(key: CryptoKey, text: string): Promise<string> {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...combined));
}

/** Decrypt a base64(iv || ciphertext) string. */
export async function decrypt(key: CryptoKey, encoded: string): Promise<string> {
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

/**
 * HMAC-SHA256(text, userId) — deterministic keyed hash used as `name_hmac`
 * so the DB can enforce UNIQUE(user_id, name_hmac) without storing plaintext.
 */
export async function computeHmac(userId: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(userId),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
