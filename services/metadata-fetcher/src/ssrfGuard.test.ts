import { describe, it, expect } from 'vitest';
import type { LookupAddress } from 'node:dns';
import { validateUrl } from './ssrfGuard.js';

function fakeResolver(addresses: Array<{ address: string; family: 4 | 6 }>) {
  return async (_host: string): Promise<LookupAddress[]> => addresses;
}

const okResolver = fakeResolver([{ address: '8.8.8.8', family: 4 }]);

describe('ssrfGuard — scheme and shape', () => {
  it('rejects file://', async () => {
    const r = await validateUrl('file:///etc/passwd', okResolver);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe('unsupported-scheme');
  });

  it('rejects ftp://', async () => {
    const r = await validateUrl('ftp://example.com', okResolver);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe('unsupported-scheme');
  });

  it('rejects javascript:', async () => {
    const r = await validateUrl('javascript:alert(1)', okResolver);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe('unsupported-scheme');
  });

  it('rejects data:', async () => {
    const r = await validateUrl('data:text/html,foo', okResolver);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe('unsupported-scheme');
  });

  it('rejects gopher:', async () => {
    const r = await validateUrl('gopher://example.com', okResolver);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe('unsupported-scheme');
  });

  it('rejects URLs with userinfo', async () => {
    const r = await validateUrl('http://user:pass@example.com', okResolver);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe('userinfo-forbidden');
  });

  it('rejects URL longer than 2000 chars', async () => {
    const long = 'http://example.com/' + 'a'.repeat(2000);
    const r = await validateUrl(long, okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects empty URL', async () => {
    const r = await validateUrl('', okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects malformed URL', async () => {
    const r = await validateUrl('not a url', okResolver);
    expect(r.ok).toBe(false);
  });
});

describe('ssrfGuard — port allowlist (scheme-default only)', () => {
  it('accepts http://example.com (no port)', async () => {
    const r = await validateUrl('http://example.com/', okResolver);
    expect(r.ok).toBe(true);
  });

  it('accepts https://example.com (no port)', async () => {
    const r = await validateUrl('https://example.com/', okResolver);
    expect(r.ok).toBe(true);
  });

  it('accepts explicit http://example.com:80', async () => {
    const r = await validateUrl('http://example.com:80/', okResolver);
    expect(r.ok).toBe(true);
  });

  it('accepts explicit https://example.com:443', async () => {
    const r = await validateUrl('https://example.com:443/', okResolver);
    expect(r.ok).toBe(true);
  });

  it('rejects port 8080', async () => {
    const r = await validateUrl('http://example.com:8080/', okResolver);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe('port-not-allowed');
  });

  it('rejects port 8443', async () => {
    const r = await validateUrl('https://example.com:8443/', okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects port 3000', async () => {
    const r = await validateUrl('http://example.com:3000/', okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects port 5432 (postgres)', async () => {
    const r = await validateUrl('http://example.com:5432/', okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects port 6379 (redis)', async () => {
    const r = await validateUrl('http://example.com:6379/', okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects port 22 (ssh)', async () => {
    const r = await validateUrl('http://example.com:22/', okResolver);
    expect(r.ok).toBe(false);
  });
});

describe('ssrfGuard — hostname canonicalisation', () => {
  // WHATWG URL parser normalises non-canonical IPv4 encodings (decimal,
  // hex, dotless) to canonical dotted-quad before we see them. The deny-list
  // then catches the resolved 127.0.0.1 / etc. Either rejection path is
  // acceptable security-wise — the property under test is "the URL is
  // rejected", not which specific reason code surfaces.
  it('rejects decimal IPv4 (2130706433 = 127.0.0.1)', async () => {
    const r = await validateUrl('http://2130706433/', okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects hex IPv4 (0x7f000001 = 127.0.0.1)', async () => {
    const r = await validateUrl('http://0x7f000001/', okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects octal IPv4 (0177.0.0.1)', async () => {
    const r = await validateUrl('http://0177.0.0.1/', okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects dotless IPv4 (127.1)', async () => {
    const r = await validateUrl('http://127.1/', okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects trailing dot (example.com.)', async () => {
    const r = await validateUrl('http://example.com./', okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects null-injection host (example.com%00.evil/)', async () => {
    const r = await validateUrl('http://example.com%00.evil/', okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects percent-encoded hostname', async () => {
    const r = await validateUrl('http://%65xample.com/', okResolver);
    expect(r.ok).toBe(false);
  });

  it('rejects double-dot hostname', async () => {
    const r = await validateUrl('http://EXAMPLE..com/', okResolver);
    expect(r.ok).toBe(false);
  });

  it('accepts canonical hostname', async () => {
    const r = await validateUrl('http://example.com/', okResolver);
    expect(r.ok).toBe(true);
  });

  it('accepts uppercase canonical hostname', async () => {
    const r = await validateUrl('http://EXAMPLE.COM/', okResolver);
    expect(r.ok).toBe(true);
  });

  it('accepts canonical IPv4 literal (then defers to deny-list)', async () => {
    const r = await validateUrl('http://127.0.0.1/', okResolver);
    // Canonical literal passes hostname check but is rejected by IP deny-list.
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe('blocked-ip');
  });
});

describe('ssrfGuard — IPv4 deny-list', () => {
  const cases: Array<[string, string]> = [
    ['127.0.0.1', 'loopback'],
    ['10.0.0.1', 'rfc1918-10'],
    ['172.16.0.1', 'rfc1918-172'],
    ['192.168.1.1', 'rfc1918-192'],
    ['169.254.169.254', 'link-local'],
    ['0.0.0.0', 'unspecified'],
    ['100.64.0.1', 'cgnat'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
  ];

  for (const [addr, label] of cases) {
    it(`rejects ${addr} (${label})`, async () => {
      const resolver = fakeResolver([{ address: addr, family: 4 }]);
      const r = await validateUrl('http://target.example/', resolver);
      expect(r.ok).toBe(false);
      expect((r as { reason: string }).reason).toBe('blocked-ip');
    });
  }

  it('accepts public IPv4 8.8.8.8', async () => {
    const resolver = fakeResolver([{ address: '8.8.8.8', family: 4 }]);
    const r = await validateUrl('http://target.example/', resolver);
    expect(r.ok).toBe(true);
  });

  it('accepts public IPv4 1.1.1.1', async () => {
    const resolver = fakeResolver([{ address: '1.1.1.1', family: 4 }]);
    const r = await validateUrl('http://target.example/', resolver);
    expect(r.ok).toBe(true);
  });
});

describe('ssrfGuard — IPv6 deny-list', () => {
  const cases: Array<[string, string]> = [
    ['::1', 'loopback'],
    ['fc00::1', 'ula'],
    ['fe80::1', 'link-local'],
    ['2001:db8::1', 'documentation'],
    ['::', 'unspecified'],
  ];

  for (const [addr, label] of cases) {
    it(`rejects ${addr} (${label})`, async () => {
      const resolver = fakeResolver([{ address: addr, family: 6 }]);
      const r = await validateUrl('http://target.example/', resolver);
      expect(r.ok).toBe(false);
      expect((r as { reason: string }).reason).toBe('blocked-ip');
    });
  }

  it('accepts public IPv6 2001:4860:4860::8888', async () => {
    const resolver = fakeResolver([{ address: '2001:4860:4860::8888', family: 6 }]);
    const r = await validateUrl('http://target.example/', resolver);
    expect(r.ok).toBe(true);
  });

  it('rejects IPv4-mapped IPv6 ::ffff:127.0.0.1', async () => {
    const resolver = fakeResolver([{ address: '::ffff:127.0.0.1', family: 6 }]);
    const r = await validateUrl('http://target.example/', resolver);
    expect(r.ok).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 ::ffff:10.0.0.1', async () => {
    const resolver = fakeResolver([{ address: '::ffff:10.0.0.1', family: 6 }]);
    const r = await validateUrl('http://target.example/', resolver);
    expect(r.ok).toBe(false);
  });
});

describe('ssrfGuard — mixed-resolution hostility', () => {
  it('rejects when resolver returns one public + one private IP', async () => {
    const resolver = fakeResolver([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    const r = await validateUrl('http://target.example/', resolver);
    expect(r.ok).toBe(false);
  });

  it('accepts when all resolved IPs are public; first chosen as dial target', async () => {
    const resolver = fakeResolver([
      { address: '8.8.8.8', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ]);
    const r = await validateUrl('http://target.example/', resolver);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dialIp).toBe('8.8.8.8');
  });
});

describe('ssrfGuard — return shape', () => {
  it('returns the resolved IP for dial-by-IP', async () => {
    const r = await validateUrl('http://example.com/path', okResolver);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.host).toBe('example.com');
      expect(r.dialIp).toBe('8.8.8.8');
      expect(r.port).toBe(80);
      expect(r.pathQuery).toBe('/path');
    }
  });

  it('captures query string', async () => {
    const r = await validateUrl('https://example.com/x?a=1&b=2', okResolver);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.port).toBe(443);
      expect(r.pathQuery).toBe('/x?a=1&b=2');
    }
  });
});

describe('IANA special-purpose IPv4 ranges (Task 5)', () => {
  it.each([
    ['192.0.0.1', 'iana-assigned'],
    ['192.0.2.10', 'test-net-1'],
    ['198.18.0.5', 'benchmarking'],
    ['198.19.255.255', 'benchmarking'],
    ['198.51.100.50', 'test-net-2'],
    ['203.0.113.5', 'test-net-3'],
    ['192.88.99.1', '6to4-anycast-deprecated'],
  ])('rejects %s as %s', async (ip, _label) => {
    const result = await validateUrl(`http://${ip}/`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-ip');
  });
});
