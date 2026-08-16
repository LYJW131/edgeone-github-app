import { handleEdgeOneWebhook } from "./edgeone";
import { GitHubApiError } from "./github";
import { handleGitHubWebhook } from "./github-webhook";
import { jsonResponse, redirect, RequestTooLargeError } from "./http";
import {
  createSetupConnection,
  deleteSetupConnection,
  handleOAuthCallback,
  showSetup,
  startOAuth,
  testables as setupTestables,
} from "./setup";

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ ok: true, service: "edgeone-github-app" });
  }
  if (request.method === "GET" && url.pathname === "/") {
    return redirect("/setup");
  }
  if (request.method === "GET" && url.pathname === "/setup") return showSetup(request, env);
  if (request.method === "GET" && url.pathname === "/auth/github/start") {
    const installationId = setupTestables.parseInstallationId(url.searchParams.get("installation_id"));
    if (!installationId) return jsonResponse({ error: "Valid installation_id required" }, 400);
    return startOAuth(env, installationId);
  }
  if (request.method === "GET" && url.pathname === "/auth/github/callback") return handleOAuthCallback(request, env);
  if (request.method === "POST" && url.pathname === "/setup/connections") return createSetupConnection(request, env);
  if (request.method === "POST" && url.pathname === "/setup/connections/delete") return deleteSetupConnection(request, env);
  if (request.method === "POST" && url.pathname === "/github/webhook") return handleGitHubWebhook(request, env);
  if (request.method === "POST" && url.pathname.startsWith("/edgeone/")) {
    const hookId = url.pathname.slice("/edgeone/".length);
    if (!hookId || hookId.includes("/")) return jsonResponse({ error: "Connection not found" }, 404);
    return handleEdgeOneWebhook(request, env, hookId);
  }
  return jsonResponse({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof RequestTooLargeError) return jsonResponse({ error: "Request body too large" }, 413);
      if (error instanceof GitHubApiError) {
        console.error("GitHub API request failed", { status: error.status });
        return jsonResponse({ error: "GitHub API request failed" }, 502);
      }
      console.error("Unhandled request error", error instanceof Error ? error.message : "Unknown error");
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
