import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommitStatus, getUserInstallation, GitHubApiError } from "../src/github";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub commit status requests", () => {
  it("links a pending status directly to the EdgeOne deployment", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("{}", {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await createCommitStatus("token", "owner", "repository", "abc123", {
      eventType: "deployment.created",
      deploymentId: "edgeone-1",
      detailsUrl: "https://example.com/deployment",
      projectName: "Example",
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(url).toBe("https://api.github.com/repos/owner/repository/statuses/abc123");
    expect(init?.method).toBe("POST");
    expect(body).toMatchObject({
      state: "pending",
      target_url: "https://example.com/deployment",
      context: "EdgeOne Makers",
    });
  });

  it("maps successful deployments to a successful status", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("{}", {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await createCommitStatus("token", "owner", "repository", "def456", {
      eventType: "deployment.succeeded",
      deploymentId: "edgeone-2",
      detailsUrl: "https://example.com/deployment",
      projectName: "Example",
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({ state: "success" });
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
