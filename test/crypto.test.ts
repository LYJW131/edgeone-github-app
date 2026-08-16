import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  randomToken,
  sha256Hex,
  signState,
  testables,
  verifyState,
} from "../src/crypto";

describe("crypto helpers", () => {
  it("generates distinct URL-safe tokens", () => {
    const first = randomToken();
    const second = randomToken();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it("hashes and compares credentials", async () => {
    const digest = await sha256Hex("secret");
    expect(digest).toHaveLength(64);
    expect(constantTimeEqual(digest, digest)).toBe(true);
    expect(constantTimeEqual(digest, `${digest.slice(0, -1)}0`)).toBe(false);
    expect(constantTimeEqual("short", "longer")).toBe(false);
  });

  it("round-trips signed state and rejects tampering", async () => {
    const state = await signState({ installationId: 42 }, "a sufficiently long test secret");
    await expect(verifyState<{ installationId: number }>(state, "a sufficiently long test secret"))
      .resolves.toEqual({ installationId: 42 });
    await expect(verifyState(`${state}x`, "a sufficiently long test secret")).resolves.toBeNull();
  });

  it("wraps GitHub PKCS#1 private keys as PKCS#8", () => {
    const pkcs1 = Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x00);
    const body = btoa(String.fromCharCode(...pkcs1));
    const pem = `-----BEGIN RSA PRIVATE KEY-----\\r\\n${body}\\r\\n-----END RSA PRIVATE KEY-----`;
    const der = new Uint8Array(testables.pemToDer(pem));

    expect([...der.slice(0, 5)]).toEqual([0x30, 0x19, 0x02, 0x01, 0x00]);
    expect([...der.slice(-pkcs1.byteLength)]).toEqual([...pkcs1]);
  });

  it("keeps PKCS#8 private keys unchanged", () => {
    const pkcs8 = Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x00);
    const body = btoa(String.fromCharCode(...pkcs8));
    const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;

    expect([...new Uint8Array(testables.pemToDer(pem))]).toEqual([...pkcs8]);
  });
});
