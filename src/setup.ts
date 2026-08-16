import { constantTimeEqual, hmacHex, randomToken, sha256Hex, signState, verifyState } from "./crypto";
import {
  exchangeOAuthCode,
  getUser,
  getUserInstallation,
  listInstallationRepositories,
  type GitHubRepository,
} from "./github";
import {
  escapeHtml,
  getCookie,
  htmlResponse,
  makeCookie,
  readBodyText,
  redirect,
} from "./http";
import {
  createConnection,
  createSetupSession,
  deleteConnection,
  getSetupSession,
  listConnections,
  type Connection,
  type SetupSession,
} from "./store";

const STATE_COOKIE = "edgeone_oauth_nonce";
const SESSION_COOKIE = "edgeone_setup_session";
const STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 8 * 60 * 60;

interface OAuthState {
  installationId: number;
  nonce: string;
  expiresAt: number;
}

function canonicalBaseUrl(env: Env): string {
  return env.PUBLIC_BASE_URL.replace(/\/+$/u, "");
}

function secureCookies(env: Env): boolean {
  return canonicalBaseUrl(env).startsWith("https://");
}

function page(title: string, content: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{max-width:960px;margin:0 auto;padding:48px 20px;line-height:1.5}a{color:#1473e6}header{margin-bottom:36px}.muted{opacity:.72}.card{border:1px solid #8885;border-radius:14px;padding:20px;margin:16px 0}label{display:block;font-weight:650;margin:14px 0 5px}input,select,button{box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #8888;border-radius:8px;background:transparent}input,select{width:100%}button,.button{display:inline-block;background:#238636;color:white;border:0;padding:10px 15px;border-radius:8px;text-decoration:none;cursor:pointer}.danger{background:#cf222e}.row{display:flex;gap:12px;align-items:center}.row input{width:auto}.copy-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px}.copy-row input{font-family:ui-monospace,monospace;background:#8882}.copy-button{min-width:82px}.copy-button[data-copied="true"]{background:#1a7f37}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #8884}code{overflow-wrap:anywhere}@media(max-width:640px){.copy-row{grid-template-columns:1fr}.copy-button{width:100%}}</style></head>
<body><header><h1>EdgeOne GitHub App</h1><p class="muted">Tencent EdgeOne Makers deployment status for GitHub.</p></header>${content}</body></html>`;
}

function parseInstallationId(value: string | null): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function sessionFromRequest(request: Request, env: Env): Promise<{ rawToken: string; session: SetupSession } | null> {
  const rawToken = getCookie(request, SESSION_COOKIE);
  if (!rawToken) return null;
  const session = await getSetupSession(env.DB, rawToken);
  return session ? { rawToken, session } : null;
}

function csrfToken(rawSessionToken: string, secret: string): Promise<string> {
  return hmacHex(secret, `setup-csrf:${rawSessionToken}`);
}

export async function startOAuth(env: Env, installationId: number): Promise<Response> {
  const nonce = randomToken(24);
  const state = await signState({
    installationId,
    nonce,
    expiresAt: Date.now() + STATE_TTL_SECONDS * 1000,
  }, env.OAUTH_STATE_SECRET);
  const callback = `${canonicalBaseUrl(env)}/auth/github/callback`;
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", callback);
  authorize.searchParams.set("state", state);
  return redirect(authorize.toString(), [makeCookie(STATE_COOKIE, nonce, STATE_TTL_SECONDS, secureCookies(env))]);
}

export async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const signedState = url.searchParams.get("state");
  const nonce = getCookie(request, STATE_COOKIE);
  if (!code || !signedState || !nonce) return htmlResponse(page("Authorization failed", "<h2>Authorization failed</h2><p>The OAuth callback is incomplete. Restart the App setup.</p>"), 400);

  const state = await verifyState<OAuthState>(signedState, env.OAUTH_STATE_SECRET);
  if (!state || state.nonce !== nonce || state.expiresAt <= Date.now() || !Number.isSafeInteger(state.installationId)) {
    return htmlResponse(page("Authorization failed", "<h2>Authorization failed</h2><p>The setup request expired or could not be verified. Restart the App setup.</p>"), 400);
  }

  const callback = `${canonicalBaseUrl(env)}/auth/github/callback`;
  const userToken = await exchangeOAuthCode(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, code, callback);
  const [user] = await Promise.all([
    getUser(userToken),
    getUserInstallation(userToken, state.installationId),
  ]);
  const rawSessionToken = randomToken(32);
  await createSetupSession(env.DB, rawSessionToken, {
    githubUserId: user.id,
    githubLogin: user.login,
    installationId: state.installationId,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  });

  return redirect(`${canonicalBaseUrl(env)}/setup`, [
    makeCookie(STATE_COOKIE, "", 0, secureCookies(env)),
    makeCookie(SESSION_COOKIE, rawSessionToken, SESSION_TTL_SECONDS, secureCookies(env)),
  ]);
}

function repositoryOptions(repositories: GitHubRepository[]): string {
  return repositories
    .sort((left, right) => left.full_name.localeCompare(right.full_name))
    .map((repository) => `<option value="${repository.id}">${escapeHtml(repository.full_name)}</option>`)
    .join("");
}

export async function showSetup(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const requestedInstallation = parseInstallationId(url.searchParams.get("installation_id"));
  const authenticated = await sessionFromRequest(request, env);
  if (!authenticated || (requestedInstallation && authenticated.session.installationId !== requestedInstallation)) {
    if (requestedInstallation) return startOAuth(env, requestedInstallation);
    const installUrl = `https://github.com/apps/${encodeURIComponent(env.GITHUB_APP_SLUG)}/installations/new`;
    return htmlResponse(page("Install", `<h2>Install the GitHub App</h2><p>Install the App on an account and choose the repositories EdgeOne may report to.</p><p><a class="button" href="${installUrl}">Install on GitHub</a></p>`));
  }

  const { rawToken, session } = authenticated;
  const [repositories, connections] = await Promise.all([
    listInstallationRepositories(env, session.installationId),
    listConnections(env.DB, session.installationId),
  ]);
  const csrf = await csrfToken(rawToken, env.OAUTH_STATE_SECRET);
  const rows = connections.length === 0
    ? "<tr><td colspan=5>No connections yet.</td></tr>"
    : connections.map((connection) => `<tr><td>${escapeHtml(`${connection.repositoryOwner}/${connection.repositoryName}`)}</td><td><code>${escapeHtml(connection.edgeoneProjectId)}</code></td><td>${escapeHtml(connection.branch)}</td><td>${escapeHtml(connection.environment)}</td><td><form method="post" action="/setup/connections/delete"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="connectionId" value="${escapeHtml(connection.id)}"><button class="danger" type="submit">Delete</button></form></td></tr>`).join("");

  return htmlResponse(page("Setup", `
<h2>Connections</h2><p>Signed in as <strong>${escapeHtml(session.githubLogin)}</strong>. Each connection gets a separate EdgeOne credential.</p>
<div class="card"><table><thead><tr><th>Repository</th><th>EdgeOne project</th><th>Branch</th><th>Environment</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>Create a connection</h2>
<form class="card" method="post" action="/setup/connections">
<input type="hidden" name="csrf" value="${csrf}">
<label for="repositoryId">Repository</label><select id="repositoryId" name="repositoryId" required>${repositoryOptions(repositories)}</select>
<label for="edgeoneProjectId">EdgeOne project ID</label><input id="edgeoneProjectId" name="edgeoneProjectId" required maxlength="200" placeholder="makers-vd4b9ycpaa0n">
<label for="branch">Deployment branch</label><input id="branch" name="branch" required maxlength="255" value="main">
<label for="environment">GitHub environment</label><input id="environment" name="environment" required maxlength="100" value="Production">
<label class="row"><input type="checkbox" name="checksEnabled" checked> Create GitHub commit status</label>
<label class="row"><input type="checkbox" name="deploymentsEnabled" checked> Create GitHub Deployments</label>
<p><button type="submit">Create connection</button></p></form>`));
}

function validText(value: string | null, maximum: number): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) return null;
  return normalized;
}

async function parseForm(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) throw new Error("Unsupported form content type");
  return new URLSearchParams(await readBodyText(request, 32 * 1024));
}

function connectionCreatedContent(webhookUrl: string, rawBearerToken: string, scriptNonce: string): string {
  return `
<h2>Connection created</h2><p>Copy these values now. The bearer token is not stored and cannot be shown again.</p>
<div class="card"><label for="webhookUrl">Webhook URL</label><div class="copy-row"><input id="webhookUrl" readonly value="${escapeHtml(webhookUrl)}"><button class="copy-button" type="button" data-copy-target="webhookUrl">Copy</button></div><label for="secretToken">Secret token</label><div class="copy-row"><input id="secretToken" readonly value="${escapeHtml(rawBearerToken)}"><button class="copy-button" type="button" data-copy-target="secretToken">Copy</button></div></div>
<p>Configure EdgeOne events <code>deployment.created</code>, <code>deployment.succeeded</code>, and <code>deployment.failed</code>.</p><p><a class="button" href="/setup">Return to setup</a></p>
<script nonce="${scriptNonce}">document.querySelectorAll("[data-copy-target]").forEach((button)=>{button.addEventListener("click",async()=>{const input=document.getElementById(button.dataset.copyTarget);if(!(input instanceof HTMLInputElement))return;let copied=false;try{await navigator.clipboard.writeText(input.value);copied=true}catch{input.select();copied=document.execCommand("copy")}if(copied){button.textContent="Copied";button.dataset.copied="true";window.setTimeout(()=>{button.textContent="Copy";delete button.dataset.copied},1600)}})})</script>`;
}

export async function createSetupConnection(request: Request, env: Env): Promise<Response> {
  const authenticated = await sessionFromRequest(request, env);
  if (!authenticated) return redirect(`${canonicalBaseUrl(env)}/setup`);
  const form = await parseForm(request);
  const expectedCsrf = await csrfToken(authenticated.rawToken, env.OAUTH_STATE_SECRET);
  if (!constantTimeEqual(form.get("csrf") ?? "", expectedCsrf)) {
    return htmlResponse(page("Invalid request", "<h2>Invalid request</h2><p>The setup form could not be verified. Reload the setup page and try again.</p>"), 403);
  }
  const repositoryId = parseInstallationId(form.get("repositoryId"));
  const edgeoneProjectId = validText(form.get("edgeoneProjectId"), 200);
  const branch = validText(form.get("branch"), 255);
  const environment = validText(form.get("environment"), 100);
  if (!repositoryId || !edgeoneProjectId || !branch || !environment) {
    return htmlResponse(page("Invalid connection", "<h2>Invalid connection</h2><p>Repository, project, branch, or environment is invalid.</p>"), 400);
  }

  const repositories = await listInstallationRepositories(env, authenticated.session.installationId);
  const repository = repositories.find((candidate) => candidate.id === repositoryId);
  if (!repository) return htmlResponse(page("Repository unavailable", "<h2>Repository unavailable</h2><p>The selected repository is not accessible to this installation.</p>"), 403);

  const now = Date.now();
  const hookId = randomToken(18);
  const rawBearerToken = randomToken(32);
  const connection: Connection = {
    id: crypto.randomUUID(),
    hookId,
    tokenHash: await sha256Hex(rawBearerToken),
    installationId: authenticated.session.installationId,
    repositoryId: repository.id,
    repositoryOwner: repository.owner.login,
    repositoryName: repository.name,
    edgeoneProjectId,
    branch,
    environment,
    checksEnabled: form.has("checksEnabled"),
    deploymentsEnabled: form.has("deploymentsEnabled"),
    createdByUserId: authenticated.session.githubUserId,
    createdAt: now,
    updatedAt: now,
  };
  if (!connection.checksEnabled && !connection.deploymentsEnabled) {
    return htmlResponse(page("Invalid connection", "<h2>Invalid connection</h2><p>Enable Checks, Deployments, or both.</p>"), 400);
  }

  try {
    await createConnection(env.DB, connection);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return htmlResponse(page("Connection exists", "<h2>Connection already exists</h2><p>This repository and EdgeOne project are already connected.</p>"), 409);
    }
    throw error;
  }

  const webhookUrl = `${canonicalBaseUrl(env)}/edgeone/${hookId}`;
  const scriptNonce = randomToken(18);
  return htmlResponse(
    page("Connection created", connectionCreatedContent(webhookUrl, rawBearerToken, scriptNonce)),
    200,
    scriptNonce,
  );
}

export async function deleteSetupConnection(request: Request, env: Env): Promise<Response> {
  const authenticated = await sessionFromRequest(request, env);
  if (!authenticated) return redirect(`${canonicalBaseUrl(env)}/setup`);
  const form = await parseForm(request);
  const expectedCsrf = await csrfToken(authenticated.rawToken, env.OAUTH_STATE_SECRET);
  if (!constantTimeEqual(form.get("csrf") ?? "", expectedCsrf)) {
    return htmlResponse(page("Invalid request", "<h2>Invalid request</h2><p>The setup form could not be verified. Reload the setup page and try again.</p>"), 403);
  }
  const connectionId = form.get("connectionId");
  if (!connectionId || connectionId.length > 100) return htmlResponse(page("Invalid connection", "<h2>Invalid connection</h2>"), 400);
  await deleteConnection(env.DB, connectionId, authenticated.session.installationId);
  return redirect(`${canonicalBaseUrl(env)}/setup`);
}

export const testables = { connectionCreatedContent, parseInstallationId, validText };
