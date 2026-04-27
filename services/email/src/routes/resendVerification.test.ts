import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';

// Hoist mock fns before vi.mock factories run
const mockQuery   = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());
const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockSendMail = vi.hoisted(() => vi.fn());

vi.mock('../config.js', () => ({
  config: { JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!' },
}));

vi.mock('../db.js', () => ({
  pool: { connect: mockConnect, query: mockPoolQuery },
}));

vi.mock('../mailer.js', () => ({
  sendMail: mockSendMail,
}));

const { resendVerificationRoute } = await import('./resendVerification.js');

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long!';
const secretKey = createSecretKey(Buffer.from(SECRET, 'utf-8'));
const VALID_USER = '00000000-0000-4000-8000-000000000001';

async function makeToken(userId = VALID_USER): Promise<string> {
  return new SignJWT({ sub: userId, role: 'app_user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secretKey);
}

function makeApp() {
  const app = Fastify({ logger: false });
  app.register(resendVerificationRoute);
  return app;
}

describe('POST /resend-verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
    mockSendMail.mockResolvedValue(undefined);
  });

  // ── Lock query uses advisory lock, not FOR UPDATE on auth.users ───────────
  // email_svc has only column-level SELECT on auth.users, so SELECT ... FOR
  // UPDATE fails with `42501 permission denied for table users`. Advisory
  // locks need no table grants and are transaction-scoped.
  it('serialisation lock uses pg_advisory_xact_lock, not FOR UPDATE on auth.users', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                                           // BEGIN
      .mockResolvedValueOnce({ rows: [] })                                                           // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                              // cooldown
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: '0' }] })                                // daily ceiling
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'a@b.c', email_verified: false }] })    // user
      .mockResolvedValueOnce({ rows: [] })                                                           // upsert_email_token
      .mockResolvedValueOnce({ rows: [] })                                                           // INSERT log
      .mockResolvedValueOnce({ rows: [] });                                                          // COMMIT

    const res = await makeApp().inject({
      method: 'POST',
      url: '/resend-verification',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.statusCode).toBe(200);

    const lockCall = mockQuery.mock.calls.find(c => /pg_advisory_xact_lock/i.test(String(c[0])));
    expect(lockCall, 'route issued a pg_advisory_xact_lock call').toBeDefined();
    // Must pass the user id as a parameter — never interpolate it into SQL.
    expect((lockCall![1] as unknown[]).some(p => p === VALID_USER)).toBe(true);

    const allSql = mockQuery.mock.calls.map(c => String(c[0])).join('\n');
    expect(allSql).not.toMatch(/FROM\s+auth\.users[^;]*FOR\s+UPDATE/i);
  });

  // ── B-1: SQL injection guard ──────────────────────────────────────────────
  it('B-1: cooldown query parameterises COOLDOWN_SECONDS (no template-literal interpolation)', async () => {
    // Set up: cooldown returns nothing, user found and unverified, upsert + insert + sendMail succeed.
    // We need cooldown SELECT + user SELECT + upsert + log INSERT to all succeed via the transaction client.
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                                           // BEGIN
      .mockResolvedValueOnce({ rows: [] })                                                           // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                              // cooldown
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: '0' }] })                                // daily ceiling
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'a@b.c', email_verified: false }] })    // user
      .mockResolvedValueOnce({ rows: [] })                                                           // upsert_email_token
      .mockResolvedValueOnce({ rows: [] })                                                           // INSERT log
      .mockResolvedValueOnce({ rows: [] });                                                          // COMMIT

    const res = await makeApp().inject({
      method: 'POST',
      url: '/resend-verification',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(200);

    // Find the cooldown SELECT — it must use a parameter for the interval, not template-literal text.
    const allCalls = [...mockQuery.mock.calls, ...mockPoolQuery.mock.calls];
    const cooldownCall = allCalls.find(c => /email_send_log/i.test(String(c[0])));
    expect(cooldownCall, 'cooldown SELECT against email_send_log was issued').toBeDefined();

    const sql = String(cooldownCall![0]);
    // Must use parameterised interval multiplication ($N * INTERVAL '1 second'),
    // never embed COOLDOWN_SECONDS (=60) directly into the SQL text.
    expect(sql).not.toMatch(/INTERVAL\s+'60\s+seconds?'/i);
    expect(sql).toMatch(/\$\d+\s*\*\s*INTERVAL\s+'1\s+second'/i);

    // Params must include the cooldown count as the second parameter.
    const params = cooldownCall![1] as unknown[];
    expect(params).toContain(60); // COOLDOWN_SECONDS
  });

  // ── S-1: cooldown returns 429 before further DB work ──────────────────────
  it('S-1: cooldown hit returns 429 before user lookup, upsert, log insert, or sendMail', async () => {
    // BEGIN, FOR UPDATE row lock, cooldown HIT, ROLLBACK
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                  // BEGIN
      .mockResolvedValueOnce({ rows: [] })                  // FOR UPDATE row lock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] }) // cooldown HIT
      .mockResolvedValueOnce({ rows: [] });                 // ROLLBACK

    const res = await makeApp().inject({
      method: 'POST',
      url: '/resend-verification',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'Too many requests' });

    const allSql = mockQuery.mock.calls.map(c => String(c[0])).join('\n');
    // No further work happened — no user-data SELECT, no upsert, no log INSERT.
    // (A `SELECT 1 FOR UPDATE` row-lock query is allowed; the user-data SELECT
    // returns email/email_verified columns and must not run.)
    expect(allSql).not.toMatch(/SELECT\s+email/i);
    expect(allSql).not.toMatch(/upsert_email_token/i);
    expect(allSql).not.toMatch(/INSERT INTO auth\.email_send_log/i);
    expect(mockSendMail).not.toHaveBeenCalled();
    // Connection is released either way.
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // ── S-1: missing Authorization header → 401 ───────────────────────────────
  it('S-1: missing Authorization header → 401, pool.connect never called', async () => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/resend-verification',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  // ── S-1: already-verified user → 200 (idempotent), no email sent ──────────
  it('S-1: already-verified user → 200, no upsert/log/sendMail', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                                          // BEGIN
      .mockResolvedValueOnce({ rows: [] })                                                          // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                             // cooldown
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: '0' }] })                               // daily ceiling
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'a@b.c', email_verified: true }] })   // user
      .mockResolvedValueOnce({ rows: [] });                                                         // ROLLBACK or COMMIT

    const res = await makeApp().inject({
      method: 'POST',
      url: '/resend-verification',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(200);
    const allSql = mockQuery.mock.calls.map(c => String(c[0])).join('\n');
    expect(allSql).not.toMatch(/upsert_email_token/i);
    expect(allSql).not.toMatch(/INSERT INTO auth\.email_send_log/i);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  // ── Daily ceiling caps mail-bombing exposure even when cooldown elapses ──
  // Without this, the 60s cooldown allows ~1,440 verification mails/24h per
  // JWT — sufficient to trash a bounce/complaint rate. The route must reject
  // with 429 once 10 successful sends have been logged in the trailing 24h.
  it('returns 429 when the per-user 24h ceiling has been hit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                                          // BEGIN
      .mockResolvedValueOnce({ rows: [] })                                                          // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                             // cooldown miss
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: '10' }] })                              // daily ceiling HIT
      .mockResolvedValueOnce({ rows: [] });                                                         // ROLLBACK

    const res = await makeApp().inject({
      method: 'POST',
      url: '/resend-verification',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(429);
    const allSql = mockQuery.mock.calls.map(c => String(c[0])).join('\n');
    // Ceiling rejection short-circuits before user lookup, upsert, log insert.
    expect(allSql).not.toMatch(/SELECT\s+email/i);
    expect(allSql).not.toMatch(/upsert_email_token/i);
    expect(allSql).not.toMatch(/INSERT INTO auth\.email_send_log/i);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // ── S-1: success path inserts log + sends email ───────────────────────────
  it('S-1: success path performs upsert, log insert, and sendMail (atomic)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                                          // BEGIN
      .mockResolvedValueOnce({ rows: [] })                                                          // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                             // cooldown
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: '0' }] })                               // daily ceiling
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'a@b.c', email_verified: false }] })   // user
      .mockResolvedValueOnce({ rows: [] })                                                          // upsert_email_token
      .mockResolvedValueOnce({ rows: [] })                                                          // INSERT log
      .mockResolvedValueOnce({ rows: [] });                                                         // COMMIT

    const res = await makeApp().inject({
      method: 'POST',
      url: '/resend-verification',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(200);
    const allSql = mockQuery.mock.calls.map(c => String(c[0])).join('\n');
    expect(allSql).toMatch(/upsert_email_token/i);
    expect(allSql).toMatch(/INSERT INTO auth\.email_send_log/i);
    expect(allSql).toMatch(/COMMIT/);
    expect(mockSendMail).toHaveBeenCalledOnce();
    expect(mockRelease).toHaveBeenCalledOnce();
  });
});
