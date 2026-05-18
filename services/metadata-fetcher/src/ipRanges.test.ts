import { describe, it, expect } from 'vitest';
import { IPV4_DENY, IPV6_DENY } from './ipRanges.js';

// The ipv4CidrRange / ipv6CidrRange helpers are module-private. We
// document — and snapshot — the invariant that no deny entry spans the
// entire address space, which is what a /0 mask would produce. The
// load-bearing protection is the runtime `bits < 1` guard in
// ipRanges.ts; if a future contributor disables the guard AND adds
// a /0 entry, this test fires.
describe('ipRanges deny lists — full-space invariant', () => {
  it('no IPv4 deny entry spans the entire address space', () => {
    const FULL = 0xffffffffn;
    for (const r of IPV4_DENY) {
      expect(r.end - r.start, `range ${r.label} is too wide`).toBeLessThan(FULL);
    }
  });

  it('no IPv6 deny entry spans the entire address space', () => {
    const FULL = (1n << 128n) - 1n;
    for (const r of IPV6_DENY) {
      expect(r.end - r.start, `range ${r.label} is too wide`).toBeLessThan(FULL);
    }
  });
});
