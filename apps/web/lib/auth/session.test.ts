import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { jwtVerify } from "jose";
import { signSession } from "./session";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-32-chars-long-xxxxxxxx";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("signSession", () => {
  it("produces a JWT that verifies with the same secret", async () => {
    const jwt = await signSession({
      sub: "alice@example.com",
      name: "Alice",
      initials: "A",
      tenant: "raas",
    });
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const { payload } = await jwtVerify(jwt, secret);
    expect(payload.sub).toBe("alice@example.com");
    expect(payload.name).toBe("Alice");
    expect(payload.tenant).toBe("raas");
  });

  it("fails verification under a different secret", async () => {
    const jwt = await signSession({
      sub: "alice@example.com",
      name: "Alice",
      initials: "A",
      tenant: "raas",
    });
    const otherSecret = new TextEncoder().encode("a-different-secret-1234567890ab");
    await expect(jwtVerify(jwt, otherSecret)).rejects.toBeDefined();
  });
});
