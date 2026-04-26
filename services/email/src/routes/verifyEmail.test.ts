import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const mockQuery   = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());

vi.mock('../config.js', () => ({
  config: { APP_BASE_URL: 'https://example.test' },
}));

vi.mock('../db.js', () => ({
  pool: { connect: mockConnect, query: vi.fn() },
}));

const { verifyEmailRoute } = await import('./verifyEmail.js');

function makeApp() {
  const app = Fastify({ logger: false });
  app.register(verifyEmailRoute);
  return app;
}

describe('GET /verify-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
  });

  // ── S-1: rollback happens on mark_email_verified failure ─────────────────
  it('S-1: rollback happens on mark_email_verified failure (and client.release() runs)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: 'u1' }] })            // redeem
      .mockRejectedValueOnce(new Error('mark_email_verified blew up'))              // mark fails
      .mockResolvedValueOnce({ rows: [] });                                          // ROLLBACK

    const res = await makeApp().inject({
      method: 'GET',
      url: '/verify-email?token=raw-token-value',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('email-verified?error=invalid');
    const sql = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(true);
    expect(sql.some(s => s.includes('COMMIT'))).toBe(false);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // ── S-1: success path commits and redirects ──────────────────────────────
  it('S-1: success path commits and redirects to /#email-verified?success=true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: 'u1' }] })            // redeem
      .mockResolvedValueOnce({ rows: [] })                                          // mark
      .mockResolvedValueOnce({ rows: [] });                                          // COMMIT

    const res = await makeApp().inject({
      method: 'GET',
      url: '/verify-email?token=raw-token-value',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('email-verified?success=true');
    const sql = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sql.some(s => s.includes('COMMIT'))).toBe(true);
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(false);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // ── S-1: invalid/expired token redirects with error=expired ──────────────
  it('S-1: redeem returns no rows → redirect with error=expired', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                  // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })     // redeem empty
      .mockResolvedValueOnce({ rows: [] });                 // ROLLBACK

    const res = await makeApp().inject({
      method: 'GET',
      url: '/verify-email?token=expired-or-bad',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('email-verified?error=expired');
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // ── S-1: missing/empty token never opens a connection ────────────────────
  it('S-1: missing token redirects with error=invalid, pool.connect never called', async () => {
    const res = await makeApp().inject({
      method: 'GET',
      url: '/verify-email',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('email-verified?error=invalid');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // ── S-1: oversize token never opens a connection ─────────────────────────
  it('S-1: oversize token (>256 chars) redirects with error=invalid', async () => {
    const huge = 'x'.repeat(257);
    const res = await makeApp().inject({
      method: 'GET',
      url: `/verify-email?token=${huge}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('email-verified?error=invalid');
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
