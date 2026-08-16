import { createGitHubAppJwt } from "./crypto";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";

export interface GitHubUser {
  id: number;
  login: string;
}

export interface GitHubInstallation {
  id: number;
  account: { login: string };
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
}

interface GitHubDeployment {
  id: number;
  payload: Record<string, unknown> | string | null;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function githubRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "edgeone-github-app",
      "X-GitHub-Api-Version": API_VERSION,
      ...init.headers,
    },
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new GitHubApiError(`GitHub API returned ${response.status}: ${detail}`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json<T>();
}

export async function exchangeOAuthCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  const body = await response.json<{ access_token?: string; error_description?: string }>();
  if (!response.ok || !body.access_token) {
    throw new GitHubApiError(body.error_description ?? "GitHub did not return a user access token", response.status);
  }
  return body.access_token;
}

export function getUser(userToken: string): Promise<GitHubUser> {
  return githubRequest<GitHubUser>("/user", userToken);
}

export async function getUserInstallation(
  userToken: string,
  installationId: number,
): Promise<GitHubInstallation> {
  for (let page = 1; page <= 10; page += 1) {
    const result = await githubRequest<{ installations: GitHubInstallation[] }>(
      `/user/installations?per_page=100&page=${page}`,
      userToken,
    );
    const installation = result.installations.find((candidate) => candidate.id === installationId);
    if (installation) return installation;
    if (result.installations.length < 100) break;
  }
  throw new GitHubApiError("GitHub App installation is not accessible to the authenticated user", 404);
}

export async function getInstallationToken(env: Env, installationId: number): Promise<string> {
  const jwt = await createGitHubAppJwt(env.GITHUB_CLIENT_ID, env.GITHUB_APP_PRIVATE_KEY);
  const result = await githubRequest<{ token: string }>(
    `/app/installations/${installationId}/access_tokens`,
    jwt,
    { method: "POST", body: "{}" },
  );
  return result.token;
}

export async function listInstallationRepositories(
  env: Env,
  installationId: number,
): Promise<GitHubRepository[]> {
  const token = await getInstallationToken(env, installationId);
  const repositories: GitHubRepository[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await githubRequest<{ repositories: GitHubRepository[] }>(
      `/installation/repositories?per_page=100&page=${page}`,
      token,
    );
    repositories.push(...result.repositories);
    if (result.repositories.length < 100) break;
  }
  return repositories;
}

export async function resolveCommitSha(
  token: string,
  owner: string,
  repository: string,
  branch: string,
): Promise<string> {
  const commit = await githubRequest<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(branch)}`,
    token,
  );
  return commit.sha;
}

export interface DeploymentPresentation {
  eventType: "deployment.created" | "deployment.succeeded" | "deployment.failed";
  deploymentId: string;
  detailsUrl: string;
  projectName: string;
}

export async function createCommitStatus(
  token: string,
  owner: string,
  repository: string,
  headSha: string,
  event: DeploymentPresentation,
): Promise<void> {
  const state = event.eventType === "deployment.created"
    ? "pending"
    : event.eventType === "deployment.succeeded"
      ? "success"
      : "failure";
  await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/statuses/${headSha}`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        state,
        target_url: event.detailsUrl,
        description: state === "success"
          ? "EdgeOne deployment completed"
          : state === "failure"
            ? "EdgeOne deployment failed"
            : "EdgeOne deployment started",
        context: "EdgeOne Makers",
      }),
    },
  );
}

function payloadMatchesDeployment(payload: GitHubDeployment["payload"], edgeoneDeploymentId: string): boolean {
  if (payload && typeof payload === "object") return payload.edgeoneDeploymentId === edgeoneDeploymentId;
  if (typeof payload !== "string") return false;
  try {
    return (JSON.parse(payload) as Record<string, unknown>).edgeoneDeploymentId === edgeoneDeploymentId;
  } catch {
    return false;
  }
}

export async function findDeployment(
  token: string,
  owner: string,
  repository: string,
  headSha: string,
  environment: string,
  edgeoneDeploymentId: string,
): Promise<number | null> {
  const deployments = await githubRequest<GitHubDeployment[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/deployments?sha=${headSha}&environment=${encodeURIComponent(environment)}&per_page=100`,
    token,
  );
  return deployments.find((deployment) => payloadMatchesDeployment(deployment.payload, edgeoneDeploymentId))?.id ?? null;
}

export async function createDeployment(
  token: string,
  owner: string,
  repository: string,
  headSha: string,
  environment: string,
  event: DeploymentPresentation,
): Promise<number> {
  const production = environment.toLowerCase() === "production";
  const deployment = await githubRequest<GitHubDeployment>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/deployments`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        ref: headSha,
        environment,
        auto_merge: false,
        required_contexts: [],
        production_environment: production,
        description: `Deploy ${event.projectName} with EdgeOne Makers`,
        payload: { provider: "edgeone-makers", edgeoneDeploymentId: event.deploymentId },
      }),
    },
  );
  return deployment.id;
}

export async function createDeploymentStatus(
  token: string,
  owner: string,
  repository: string,
  deploymentId: number,
  environment: string,
  event: DeploymentPresentation,
): Promise<void> {
  const state = event.eventType === "deployment.created"
    ? "in_progress"
    : event.eventType === "deployment.succeeded"
      ? "success"
      : "failure";
  await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/deployments/${deploymentId}/statuses`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        state,
        environment,
        environment_url: event.detailsUrl,
        log_url: event.detailsUrl,
        description: state === "success" ? "EdgeOne deployment completed" : state === "failure" ? "EdgeOne deployment failed" : "EdgeOne deployment started",
        auto_inactive: state === "success",
      }),
    },
  );
}
