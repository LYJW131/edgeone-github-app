import { afterEach, describe, expect, it, vi } from "vitest";
import { getUserInstallation, GitHubApiError, syncCheckRun } from "../src/github";

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

describe("GitHub App installation authorization", () => {
  it("finds the requested installation through the authenticated user's installation list", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      installations: [
        { id: 41, account: { login: "other" } },
        { id: 42, account: { login: "owner" } },
      ],
    }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getUserInstallation("user-token", 42)).resolves.toMatchObject({
      id: 42,
      account: { login: "owner" },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/user/installations?per_page=100&page=1",
    );
  });

  it("rejects an installation that the authenticated user cannot access", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ installations: [] }), {
      headers: { "Content-Type": "application/json" },
    })));

    await expect(getUserInstallation("user-token", 404)).rejects.toEqual(
      new GitHubApiError("GitHub App installation is not accessible to the authenticated user", 404),
    );
  });
});
