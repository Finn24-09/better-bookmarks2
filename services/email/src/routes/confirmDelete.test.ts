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
  // M-1: BEGIN → redeem → delete_account_with_password (TRUE) → COMMIT,
  // all via client.query (single transaction).
  mockQuery
    .mockResolvedValueOnce({ rows: [] })                                          // BEGIN
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: userId }] })           // redeem
    .mockResolvedValueOnce({ rows: [{ delete_account_with_password: true }] })    // delete (correct pw)
    .mockResolvedValueOnce({ rows: [] });                                          // COMMIT
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
    // pool.query is used only for the audit-log INSERT after the tx commits.
    mockPoolQuery.mockResolvedValue({ rows: [] });

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
    // M-1: delete_account_with_password runs via the transaction client.
    expect(sql.some(s => s.includes('delete_account_with_password'))).toBe(true);
    expect(mockRelease).toHaveBeenCalledOnce();
    // pool.query is only used for the audit log; never for the delete itself.
    expect(mockPoolQuery).toHaveBeenCalledOnce();
    expect(String(mockPoolQuery.mock.calls[0][0])).toMatch(/security_audit_log/);
  });

  // TC-2 ──────────────────────────────────────────────────────────────────
  // M-1: After moving password verification into the same transaction as
  // token redemption, a wrong password must ROLLBACK (not COMMIT) — so the
  // token row stays unused and the legitimate user can retry with it.
  it('TC-2 (M-1): valid token + wrong password → 400 "Invalid password", redemption ROLLED BACK (token NOT consumed)', async () => {
    // Sequence: BEGIN → redeem → delete_account (returns false) → ROLLBACK
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: VALID_USER }] })       // redeem
      .mockResolvedValueOnce({ rows: [{ delete_account_with_password: false }] })   // wrong password
      .mockResolvedValueOnce({ rows: [] });                                          // ROLLBACK

    const res = await makeApp().inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'raw-token', password: 'WrongPass1!' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid password' });
    const sql = mockQuery.mock.calls.map((c) => String(c[0]));
    // M-1: Token redemption is ROLLED BACK on wrong password — UPDATE used_at
    // never commits, so the token can be reused by the legitimate owner.
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(true);
    expect(sql.some(s => s.includes('COMMIT'))).toBe(false);
    // Password verification ran on the SAME client, not via pool.query.
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(sql.some(s => s.includes('delete_account_with_password'))).toBe(true);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // TC-2b (M-1) ─────────────────────────────────────────────────────────────
  // The legitimate user can RETRY with the same token after a wrong-password
  // attempt, because the redemption was rolled back. Simulated by issuing two
  // requests with the same token: first wrong, second correct.
  it('TC-2b (M-1): same token usable after a wrong-password attempt', async () => {
    const app = makeApp();

    // Attempt 1 — wrong password, token NOT consumed (ROLLBACK).
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: VALID_USER }] })       // redeem
      .mockResolvedValueOnce({ rows: [{ delete_account_with_password: false }] })   // wrong password
      .mockResolvedValueOnce({ rows: [] });                                          // ROLLBACK

    const res1 = await app.inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'shared-token', password: 'WrongPass1!' }),
    });
    expect(res1.statusCode).toBe(400);

    // Attempt 2 — correct password using the SAME token. Because the previous
    // redemption was rolled back, redeem returns the user_id again and we COMMIT.
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: VALID_USER }] })       // redeem
      .mockResolvedValueOnce({ rows: [{ delete_account_with_password: true }] })    // correct
      .mockResolvedValueOnce({ rows: [] });                                          // COMMIT

    const res2 = await app.inject({
      method: 'POST',
      url: '/confirm-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'shared-token', password: 'CorrectPass1!' }),
    });

    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toEqual({ ok: true });
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
