/**
 * manifest-import — SSRF guard on `fetch-url` (review S1 BLOCKER).
 *
 * Coverage:
 *   1. file:// rejected at the scheme check
 *   2. http:// rejected (no localhost opt-in in tests)
 *   3. https URL that resolves to RFC1918 (10.x) rejected at the DNS check
 *   4. https URL that resolves to link-local / AWS metadata (169.254.169.254) rejected
 *   5. https URL that resolves to loopback rejected
 *   6. Pure address predicate (`__test.isBlockedAddress`) — covers v6 cases the
 *      DNS-dependent branches can't exercise without network mocks.
 *
 * For #3-5 we DNS-mock `dns.lookup` to deterministically return the address
 * we want, since real DNS for example.com isn't private. The mock is
 * installed per-test and removed after.
 */

import { describe, it, expect } from "vitest";
import dns from "node:dns/promises";
import { assertSafeOutboundUrl, SsrfError, __test } from "../src/services/ssrf-guard";

describe("ssrf-guard: assertSafeOutboundUrl", () => {
  it("rejects file:// schemes", async () => {
    await expect(assertSafeOutboundUrl("file:///etc/passwd")).rejects.toMatchObject({
      name: "SsrfError",
      code: "scheme_not_allowed",
    });
  });

  it("rejects ftp:// schemes", async () => {
    await expect(assertSafeOutboundUrl("ftp://ftp.example.com/")).rejects.toMatchObject({
      name: "SsrfError",
      code: "scheme_not_allowed",
    });
  });

  it("rejects data: urls", async () => {
    await expect(assertSafeOutboundUrl("data:text/plain,hello")).rejects.toMatchObject({
      name: "SsrfError",
      code: "scheme_not_allowed",
    });
  });

  it("rejects http:// when AGENTIC_FETCH_ALLOW_HTTP_LOCALHOST is unset", async () => {
    delete process.env.AGENTIC_FETCH_ALLOW_HTTP_LOCALHOST;
    await expect(assertSafeOutboundUrl("http://localhost:3000/")).rejects.toMatchObject({
      name: "SsrfError",
      code: "https_only",
    });
  });

  it("accepts http://localhost when AGENTIC_FETCH_ALLOW_HTTP_LOCALHOST=1", async () => {
    process.env.AGENTIC_FETCH_ALLOW_HTTP_LOCALHOST = "1";
    // The DNS lookup will return 127.0.0.1, which IS blocked — so this STILL
    // throws blocked_target. That's the right behavior: the dev opt-in only
    // bypasses the scheme check, not the IP check; we never want the
    // metadata 169.254.169.254 reachable just because it tunnels through
    // localhost. End-to-end the dev path uses a non-mocked lookup that
    // happens to return 127.0.0.1, which we still treat as loopback.
    try {
      await expect(assertSafeOutboundUrl("http://localhost/")).rejects.toMatchObject({
        name: "SsrfError",
        code: "blocked_target",
      });
    } finally {
      delete process.env.AGENTIC_FETCH_ALLOW_HTTP_LOCALHOST;
    }
  });

  it("rejects RFC1918 10.x targets (DNS-mocked)", async () => {
    const orig = dns.lookup;
    (dns as unknown as { lookup: typeof dns.lookup }).lookup = (async () =>
      ({ address: "10.0.0.1", family: 4 })) as never;
    try {
      await expect(assertSafeOutboundUrl("https://internal.example/")).rejects.toMatchObject({
        name: "SsrfError",
        code: "blocked_target",
      });
    } finally {
      (dns as unknown as { lookup: typeof dns.lookup }).lookup = orig;
    }
  });

  it("rejects AWS metadata 169.254.169.254 (DNS-mocked)", async () => {
    const orig = dns.lookup;
    (dns as unknown as { lookup: typeof dns.lookup }).lookup = (async () =>
      ({ address: "169.254.169.254", family: 4 })) as never;
    try {
      await expect(assertSafeOutboundUrl("https://metadata.aws/")).rejects.toMatchObject({
        name: "SsrfError",
        code: "blocked_target",
      });
    } finally {
      (dns as unknown as { lookup: typeof dns.lookup }).lookup = orig;
    }
  });

  it("rejects loopback (DNS-mocked)", async () => {
    const orig = dns.lookup;
    (dns as unknown as { lookup: typeof dns.lookup }).lookup = (async () =>
      ({ address: "127.0.0.1", family: 4 })) as never;
    try {
      await expect(assertSafeOutboundUrl("https://loopback.example/")).rejects.toMatchObject({
        name: "SsrfError",
        code: "blocked_target",
      });
    } finally {
      (dns as unknown as { lookup: typeof dns.lookup }).lookup = orig;
    }
  });

  it("accepts a public-IP target (DNS-mocked)", async () => {
    // Simulate gist.githubusercontent.com → some public IP (140.82.x.x).
    const orig = dns.lookup;
    (dns as unknown as { lookup: typeof dns.lookup }).lookup = (async () =>
      ({ address: "140.82.121.4", family: 4 })) as never;
    try {
      const u = await assertSafeOutboundUrl("https://gist.githubusercontent.com/foo/bar");
      expect(u.hostname).toBe("gist.githubusercontent.com");
    } finally {
      (dns as unknown as { lookup: typeof dns.lookup }).lookup = orig;
    }
  });

  it("rejects bad URLs cleanly", async () => {
    await expect(assertSafeOutboundUrl("not a url")).rejects.toMatchObject({
      name: "SsrfError",
      code: "bad_url",
    });
  });
});

describe("ssrf-guard: isBlockedAddress predicate", () => {
  // The DNS-dependent paths cover the IPv4 happy/sad paths above; this set
  // catches IPv6, the more obscure RFC1918 ranges, and the 0.0.0.0 edge.
  const cases: Array<[string, boolean]> = [
    ["0.0.0.0", true],
    ["127.0.0.1", true],
    ["10.255.255.255", true],
    ["172.15.0.1", false], // just outside RFC1918 (172.16-31)
    ["172.16.0.1", true],
    ["172.31.0.1", true],
    ["172.32.0.1", false],
    ["192.168.0.1", true],
    ["169.254.0.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true], // CGNAT
    ["100.127.255.255", true],
    ["100.128.0.0", false], // outside CGNAT
    ["8.8.8.8", false],
    ["140.82.121.4", false], // public github
    ["::1", true],
    ["::", true],
    ["fd00::1", true],
    ["fc00::1", true],
    ["fe80::1", true],
    ["ff02::1", true], // multicast
    ["2001:4860:4860::8888", false], // Google DNS, public
    ["::ffff:10.0.0.1", true], // IPv4-mapped private
    ["::ffff:8.8.8.8", false],
  ];
  for (const [addr, expected] of cases) {
    it(`${addr} → ${expected ? "blocked" : "ok"}`, () => {
      expect(__test.isBlockedAddress(addr)).toBe(expected);
    });
  }
});

describe("ssrf-guard: error class", () => {
  it("SsrfError carries the policy code", () => {
    const e = new SsrfError("blocked_target", "test");
    expect(e.code).toBe("blocked_target");
    expect(e.name).toBe("SsrfError");
    expect(e instanceof Error).toBe(true);
  });
});
