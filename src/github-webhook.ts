import { constantTimeEqual, hmacHex } from "./crypto";
import { jsonResponse, readBodyText } from "./http";
import { deleteInstallation, deleteInstallationRepositories } from "./store";

interface GitHubWebhookPayload {
  action?: string;
  installation?: { id?: number };
  repositories_removed?: Array<{ id?: number }>;
}

export async function handleGitHubWebhook(request: Request, env: Env): Promise<Response> {
  const rawBody = await readBodyText(request, 1024 * 1024);
  const signature = request.headers.get("x-hub-signature-256");
  if (!signature?.startsWith("sha256=")) return jsonResponse({ error: "Missing signature" }, 401);
  const expected = `sha256=${await hmacHex(env.GITHUB_WEBHOOK_SECRET, rawBody)}`;
  if (!constantTimeEqual(signature, expected)) return jsonResponse({ error: "Invalid signature" }, 401);

  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubWebhookPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const event = request.headers.get("x-github-event");
  const installationId = payload.installation?.id;
  if (event === "installation" && payload.action === "deleted" && installationId) {
    await deleteInstallation(env.DB, installationId);
  }
  if (event === "installation_repositories" && payload.action === "removed" && installationId) {
    const repositoryIds = (payload.repositories_removed ?? [])
      .map((repository) => repository.id)
      .filter((id): id is number => typeof id === "number");
    await deleteInstallationRepositories(env.DB, installationId, repositoryIds);
  }
  return jsonResponse({ ok: true });
}
