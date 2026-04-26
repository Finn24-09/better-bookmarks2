import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';

// Hoist mock fns before vi.mock factories run
const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());
const mockPoolQuery = vi.hoisted(() => vi.fn());

vi.mock('../config.js', () => ({
  config: { JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!' },
}));

vi.mock('../db.js', () => ({
  pool: { connect: mockConnect, query: mockPoolQuery },
}));

const { confirmDeleteRoute } = await import('./confirmDelete.js');

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long!';
const secretKey = createSecretKey(Buffer.from(SECRET, 'utf-8'));
const VALID_USER   = '00000000-0000-4000-8000-000000000001';
const OTHER_USER   = '00000000-0000-4000-8000-000000000002';

async function makeToken(userId = VALID_USER): Promise<string> {
  return new SignJWT({ sub: userId, role: 'app_user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secretKey);
}

function makeApp() {
  const app = Fastify({ logger: false });
  app.register(confirmDeleteRoute);
  return app;
}

// ── helpers ────────────────────────────────────────────────────────────────

function setupRedeemSuccess(userId = VALID_USER) {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })                               // BEGIN
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: userId }] }) // redeem
    .mockResolvedValueOnce({ rows: [] });                              // COMMIT
}

function setupRedeemEmpty() {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })        // BEGIN
    .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // redeem: no match
    .mockResolvedValueOnce({ rows: [] });        // ROLLBACK
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('POST /confirm-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
  });

  // TC-1 ──────────────────────────────────────────────────────────────────
  it('TC-1: valid token + correct password → 200 { ok: true }', async () => {
    setupRedeemSuccess();
    // pool.query used for delete + audit log insert
    mockPoolQuery.mockResolvedValue({ rows: [{ delete_account_with_password: true }] });

    const res = await makeApp().inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'raw-token', password: 'CorrectPass1!' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const sql = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sql.some(s => s.includes('COMMIT'))).toBe(true);
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(false);
    expect(mockRelease).toHaveBeenCalledOnce();
    expect(mockPoolQuery).toHaveBeenCalled(); // delete + audit log
  });

  // TC-2 ──────────────────────────────────────────────────────────────────
  it('TC-2: valid token + wrong password → 400 "Invalid password", token committed (consumed)', async () => {
    setupRedeemSuccess();
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ delete_account_with_password: false }] });

    const res = await makeApp().inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'raw-token', password: 'WrongPass1!' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid password' });
    const sql = mockQuery.mock.calls.map((c) => String(c[0]));
    // Token was COMMITTED (permanently consumed) even though password was wrong
    expect(sql.some(s => s.includes('COMMIT'))).toBe(true);
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(false);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // TC-3 ──────────────────────────────────────────────────────────────────
  it('TC-3: invalid/expired token → 400 "Invalid or expired token", delete never called', async () => {
    setupRedeemEmpty();

    const res = await makeApp().inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'bad-token', password: 'SomePass1!' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid or expired token' });
    const sql = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(true);
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // TC-4 ──────────────────────────────────────────────────────────────────
  it('TC-4: token belongs to different user → 400 "Invalid or expired token"', async () => {
    // Redeem returns OTHER_USER but JWT sub is VALID_USER
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: OTHER_USER }] })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const res = await makeApp().inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { authorization: `Bearer ${await makeToken(VALID_USER)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'other-users-token', password: 'SomePass1!' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid or expired token' });
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // TC-5 ──────────────────────────────────────────────────────────────────
  it('TC-5: missing Authorization header → 401, pool.connect never called', async () => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'tok', password: 'SomePass1!' }),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // TC-6 ──────────────────────────────────────────────────────────────────
  it('TC-6: missing password field → 400 "Invalid request", pool.connect never called', async () => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'tok' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid request' });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // TC-7 ──────────────────────────────────────────────────────────────────
  it('TC-7: missing token field → 400 "Invalid request", pool.connect never called', async () => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'SomePass1!' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid request' });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // TC-8 ──────────────────────────────────────────────────────────────────
  it('TC-8: double-redemption → second call returns 400 "Invalid or expired token"', async () => {
    const app = makeApp();

    // First call: succeeds
    setupRedeemSuccess();
    mockPoolQuery.mockResolvedValue({ rows: [{ delete_account_with_password: true }] });
    await app.inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'raw-token', password: 'CorrectPass1!' }),
    });

    // Reset and simulate token already used (redeem returns 0 rows)
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
    setupRedeemEmpty();

    const res = await app.inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'raw-token', password: 'CorrectPass1!' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid or expired token' });
  });

  // TC-9 ──────────────────────────────────────────────────────────────────
  it('TC-9: DB throws during redeem → 500 "Internal error", client.release() called', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })             // BEGIN
      .mockRejectedValueOnce(new Error('connection reset')) // redeem throws
      .mockResolvedValueOnce({ rows: [] });             // ROLLBACK (via .catch)

    const res = await makeApp().inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'raw-token', password: 'SomePass1!' }),
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal error' });
    expect(mockRelease).toHaveBeenCalledOnce();
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});
