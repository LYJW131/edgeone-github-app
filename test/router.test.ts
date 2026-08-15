import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("router", () => {
  it("serves health without accessing tenant state", async () => {
    const response = await worker.fetch(new Request("https://example.com/health"), {} as Env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "edgeone-github-app" });
  });

  it("returns JSON 404 for unknown routes", async () => {
    const response = await worker.fetch(new Request("https://example.com/missing"), {} as Env);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });
});
