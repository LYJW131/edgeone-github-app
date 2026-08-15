import { afterEach, describe, expect, it, vi } from "vitest";
import { syncCheckRun } from "../src/github";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub Check Run requests", () => {
  it("does not send immutable head_sha when updating a Check Run", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 99, external_id: "edgeone-1" }), {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await syncCheckRun("token", "owner", "repository", "abc123", {
      eventType: "deployment.succeeded",
      deploymentId: "edgeone-1",
      detailsUrl: "https://example.com/deployment",
      projectName: "Example",
    }, 99);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(init.method).toBe("PATCH");
    expect(body).not.toHaveProperty("head_sha");
    expect(body).toMatchObject({ status: "completed", conclusion: "success" });
  });

  it("includes head_sha when creating a Check Run", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 100, external_id: "edgeone-2" }), {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await syncCheckRun("token", "owner", "repository", "def456", {
      eventType: "deployment.created",
      deploymentId: "edgeone-2",
      detailsUrl: "https://example.com/deployment",
      projectName: "Example",
    }, null);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ head_sha: "def456", status: "in_progress" });
  });
});
