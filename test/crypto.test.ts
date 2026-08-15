import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  randomToken,
  sha256Hex,
  signState,
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
});
