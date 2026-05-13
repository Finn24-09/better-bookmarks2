// IP range constants for the SSRF guard. Kept in a separate module so the
// security-critical list can be reviewed (and audited via git blame) without
// the surrounding parser logic. Ranges are decoded once at module load into
// `{ start, end }` bigint pairs covering both v4 and v6.

export interface IpRange {
  start: bigint;
  end: bigint;
  label: string;
}

function ipv4ToBigInt(addr: string): bigint {
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`bad IPv4: ${addr}`);
  }
  return ((BigInt(parts[0]) << 24n) | (BigInt(parts[1]) << 16n) | (BigInt(parts[2]) << 8n) | BigInt(parts[3])) & 0xffffffffn;
}

function ipv4CidrRange(cidr: string, label: string): IpRange {
  const [addr, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) throw new Error(`bad IPv4 CIDR: ${cidr}`);
  const base = ipv4ToBigInt(addr);
  const mask = bits === 0 ? 0n : (0xffffffffn << BigInt(32 - bits)) & 0xffffffffn;
  const start = base & mask;
  const end = start | (~mask & 0xffffffffn);
  return { start, end, label };
}

function ipv6ToBigInt(addr: string): bigint {
  // Minimal IPv6 parser: handles `::` shorthand and IPv4-mapped tails.
  const hasV4 = /\d+\.\d+\.\d+\.\d+$/.test(addr);
  let groups: string[];
  if (addr.includes('::')) {
    const [head, tail] = addr.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    let v4Tail: string[] = [];
    if (hasV4 && tailParts.length > 0) {
      const last = tailParts[tailParts.length - 1];
      tailParts.pop();
      const v4Bytes = last.split('.').map(n => Number(n));
      v4Tail = [
        ((v4Bytes[0] << 8) | v4Bytes[1]).toString(16),
        ((v4Bytes[2] << 8) | v4Bytes[3]).toString(16),
      ];
    }
    const totalGroups = 8;
    const known = headParts.length + tailParts.length + v4Tail.length;
    const zeros = Array(totalGroups - known).fill('0');
    groups = [...headParts, ...zeros, ...tailParts, ...v4Tail];
  } else {
    const parts = addr.split(':');
    if (hasV4) {
      const last = parts[parts.length - 1];
      parts.pop();
      const v4Bytes = last.split('.').map(n => Number(n));
      parts.push(((v4Bytes[0] << 8) | v4Bytes[1]).toString(16));
      parts.push(((v4Bytes[2] << 8) | v4Bytes[3]).toString(16));
    }
    groups = parts;
  }
  if (groups.length !== 8) throw new Error(`bad IPv6: ${addr}`);
  let result = 0n;
  for (const g of groups) {
    if (g.length > 4 || !/^[0-9a-fA-F]*$/.test(g)) throw new Error(`bad IPv6 group: ${g}`);
    result = (result << 16n) | BigInt(parseInt(g || '0', 16));
  }
  return result;
}

function ipv6CidrRange(cidr: string, label: string): IpRange {
  const [addr, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 128) throw new Error(`bad IPv6 CIDR: ${cidr}`);
  const base = ipv6ToBigInt(addr);
  const fullMask = (1n << 128n) - 1n;
  const mask = bits === 0 ? 0n : (fullMask << BigInt(128 - bits)) & fullMask;
  const start = base & mask;
  const end = start | (~mask & fullMask);
  return { start, end, label };
}

// IPv4 denied ranges. Covers RFC1918, loopback, link-local (incl. cloud
// instance-metadata 169.254.169.254 used by AWS / GCP / Azure / Alibaba / DO),
// CGNAT, multicast, reserved, unspecified.
export const IPV4_DENY: ReadonlyArray<IpRange> = Object.freeze([
  ipv4CidrRange('0.0.0.0/8', 'unspecified'),
  ipv4CidrRange('10.0.0.0/8', 'rfc1918-10'),
  ipv4CidrRange('100.64.0.0/10', 'cgnat'),
  ipv4CidrRange('127.0.0.0/8', 'loopback'),
  ipv4CidrRange('169.254.0.0/16', 'link-local'),
  ipv4CidrRange('172.16.0.0/12', 'rfc1918-172'),
  ipv4CidrRange('192.168.0.0/16', 'rfc1918-192'),
  // IANA special-purpose registry (RFC 6890 master list).
  ipv4CidrRange('192.0.0.0/24', 'iana-assigned'),         // RFC 6890
  ipv4CidrRange('192.0.2.0/24', 'test-net-1'),            // RFC 5737
  ipv4CidrRange('192.88.99.0/24', '6to4-anycast'),        // RFC 7526 (deprecated, must not route)
  ipv4CidrRange('198.18.0.0/15', 'benchmarking'),         // RFC 2544
  ipv4CidrRange('198.51.100.0/24', 'test-net-2'),         // RFC 5737
  ipv4CidrRange('203.0.113.0/24', 'test-net-3'),          // RFC 5737
  ipv4CidrRange('224.0.0.0/4', 'multicast'),
  ipv4CidrRange('240.0.0.0/4', 'reserved'),
]);

// IPv6 denied ranges. IPv4-mapped IPv6 (::ffff:0:0/96) is also handled by the
// dotted-form decoder in ssrfGuard.checkAddress for finer-grained logging,
// but the wholesale /96 entry below is the authoritative deny — it also
// catches the compressed-hex notation (e.g. ::ffff:7f00:1) that the
// dotted-form regex misses. dns.lookup({verbatim:true}) returns A records
// with family:4 (never v4-mapped), so the wholesale block does not regress
// any legitimate fetch.
export const IPV6_DENY: ReadonlyArray<IpRange> = Object.freeze([
  ipv6CidrRange('::/128', 'unspecified'),
  ipv6CidrRange('::1/128', 'loopback'),
  ipv6CidrRange('::ffff:0:0/96', 'ipv4-mapped'),
  ipv6CidrRange('fc00::/7', 'ula'),
  ipv6CidrRange('fe80::/10', 'link-local'),
  ipv6CidrRange('2001:db8::/32', 'documentation'),
]);

export function isIpv4Denied(ip: bigint): IpRange | null {
  for (const r of IPV4_DENY) {
    if (ip >= r.start && ip <= r.end) return r;
  }
  return null;
}

export function isIpv6Denied(ip: bigint): IpRange | null {
  for (const r of IPV6_DENY) {
    if (ip >= r.start && ip <= r.end) return r;
  }
  return null;
}

export { ipv4ToBigInt, ipv6ToBigInt };
