import { sha256Hex } from "./crypto";

export interface Connection {
  id: string;
  hookId: string;
  tokenHash: string;
  installationId: number;
  repositoryId: number;
  repositoryOwner: string;
  repositoryName: string;
  edgeoneProjectId: string;
  branch: string;
  environment: string;
  checksEnabled: boolean;
  deploymentsEnabled: boolean;
  createdByUserId: number;
  createdAt: number;
  updatedAt: number;
}

export interface SetupSession {
  githubUserId: number;
  githubLogin: string;
  installationId: number;
  expiresAt: number;
}

export interface DeploymentState {
  connectionId: string;
  edgeoneDeploymentId: string;
  headSha: string;
  checkRunId: number | null;
  githubDeploymentId: number | null;
  lastEventType: string;
}

interface ConnectionRow {
  id: string;
  hook_id: string;
  token_hash: string;
  installation_id: number;
  repository_id: number;
  repository_owner: string;
  repository_name: string;
  edgeone_project_id: string;
  branch: string;
  environment: string;
  checks_enabled: number;
  deployments_enabled: number;
  created_by_user_id: number;
  created_at: number;
  updated_at: number;
}

interface SetupSessionRow {
  github_user_id: number;
  github_login: string;
  installation_id: number;
  expires_at: number;
}

interface DeploymentStateRow {
  connection_id: string;
  edgeone_deployment_id: string;
  head_sha: string;
  check_run_id: number | null;
  github_deployment_id: number | null;
  last_event_type: string;
}

function connectionFromRow(row: ConnectionRow): Connection {
  return {
    id: row.id,
    hookId: row.hook_id,
    tokenHash: row.token_hash,
    installationId: row.installation_id,
    repositoryId: row.repository_id,
    repositoryOwner: row.repository_owner,
    repositoryName: row.repository_name,
    edgeoneProjectId: row.edgeone_project_id,
    branch: row.branch,
    environment: row.environment,
    checksEnabled: row.checks_enabled === 1,
    deploymentsEnabled: row.deployments_enabled === 1,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stateFromRow(row: DeploymentStateRow): DeploymentState {
  return {
    connectionId: row.connection_id,
    edgeoneDeploymentId: row.edgeone_deployment_id,
    headSha: row.head_sha,
    checkRunId: row.check_run_id,
    githubDeploymentId: row.github_deployment_id,
    lastEventType: row.last_event_type,
  };
}

export async function createSetupSession(
  db: D1Database,
  rawToken: string,
  session: SetupSession,
): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM setup_sessions WHERE expires_at <= ?").bind(now),
    db.prepare(
      `INSERT INTO setup_sessions
       (token_hash, github_user_id, github_login, installation_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(await sha256Hex(rawToken), session.githubUserId, session.githubLogin, session.installationId, session.expiresAt, now),
  ]);
}

export async function getSetupSession(db: D1Database, rawToken: string): Promise<SetupSession | null> {
  const row = await db.prepare(
    `SELECT github_user_id, github_login, installation_id, expires_at
     FROM setup_sessions WHERE token_hash = ? AND expires_at > ?`,
  ).bind(await sha256Hex(rawToken), Date.now()).first<SetupSessionRow>();
  return row ? {
    githubUserId: row.github_user_id,
    githubLogin: row.github_login,
    installationId: row.installation_id,
    expiresAt: row.expires_at,
  } : null;
}

export async function getConnectionByHook(db: D1Database, hookId: string): Promise<Connection | null> {
  const row = await db.prepare("SELECT * FROM connections WHERE hook_id = ?").bind(hookId).first<ConnectionRow>();
  return row ? connectionFromRow(row) : null;
}

export async function listConnections(db: D1Database, installationId: number): Promise<Connection[]> {
  const result = await db.prepare(
    "SELECT * FROM connections WHERE installation_id = ? ORDER BY created_at DESC",
  ).bind(installationId).all<ConnectionRow>();
  return result.results.map(connectionFromRow);
}

export async function createConnection(db: D1Database, connection: Connection): Promise<void> {
  await db.prepare(
    `INSERT INTO connections
     (id, hook_id, token_hash, installation_id, repository_id, repository_owner, repository_name,
      edgeone_project_id, branch, environment, checks_enabled, deployments_enabled,
      created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    connection.id,
    connection.hookId,
    connection.tokenHash,
    connection.installationId,
    connection.repositoryId,
    connection.repositoryOwner,
    connection.repositoryName,
    connection.edgeoneProjectId,
    connection.branch,
    connection.environment,
    connection.checksEnabled ? 1 : 0,
    connection.deploymentsEnabled ? 1 : 0,
    connection.createdByUserId,
    connection.createdAt,
    connection.updatedAt,
  ).run();
}

export async function deleteConnection(db: D1Database, connectionId: string, installationId: number): Promise<boolean> {
  const result = await db.prepare(
    "DELETE FROM connections WHERE id = ? AND installation_id = ?",
  ).bind(connectionId, installationId).run();
  return (result.meta.changes ?? 0) > 0;
}

export function deleteInstallation(db: D1Database, installationId: number): Promise<D1Result[]> {
  return db.batch([
    db.prepare("DELETE FROM connections WHERE installation_id = ?").bind(installationId),
    db.prepare("DELETE FROM setup_sessions WHERE installation_id = ?").bind(installationId),
  ]);
}

export function deleteInstallationRepositories(
  db: D1Database,
  installationId: number,
  repositoryIds: number[],
): Promise<D1Result[]> {
  if (repositoryIds.length === 0) return Promise.resolve([]);
  return db.batch(repositoryIds.map((id) => db.prepare(
    "DELETE FROM connections WHERE installation_id = ? AND repository_id = ?",
  ).bind(installationId, id)));
}

export async function ensureDeploymentState(
  db: D1Database,
  connectionId: string,
  edgeoneDeploymentId: string,
  headSha: string,
): Promise<DeploymentState> {
  const now = Date.now();
  await db.prepare(
    `INSERT OR IGNORE INTO deployment_states
     (connection_id, edgeone_deployment_id, head_sha, check_run_id, github_deployment_id, last_event_type, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, '', ?, ?)`,
  ).bind(connectionId, edgeoneDeploymentId, headSha, now, now).run();
  const row = await db.prepare(
    "SELECT * FROM deployment_states WHERE connection_id = ? AND edgeone_deployment_id = ?",
  ).bind(connectionId, edgeoneDeploymentId).first<DeploymentStateRow>();
  if (!row) throw new Error("Failed to create deployment state");
  return stateFromRow(row);
}

export async function getDeploymentState(
  db: D1Database,
  connectionId: string,
  edgeoneDeploymentId: string,
): Promise<DeploymentState | null> {
  const row = await db.prepare(
    "SELECT * FROM deployment_states WHERE connection_id = ? AND edgeone_deployment_id = ?",
  ).bind(connectionId, edgeoneDeploymentId).first<DeploymentStateRow>();
  return row ? stateFromRow(row) : null;
}

export async function updateDeploymentState(
  db: D1Database,
  state: DeploymentState,
): Promise<void> {
  await db.prepare(
    `UPDATE deployment_states SET check_run_id = ?, github_deployment_id = ?, last_event_type = ?, updated_at = ?
     WHERE connection_id = ? AND edgeone_deployment_id = ?`,
  ).bind(
    state.checkRunId,
    state.githubDeploymentId,
    state.lastEventType,
    Date.now(),
    state.connectionId,
    state.edgeoneDeploymentId,
  ).run();
}

export async function claimDeploymentEvent(
  db: D1Database,
  connectionId: string,
  edgeoneDeploymentId: string,
  eventType: string,
): Promise<boolean> {
  const now = Date.now();
  const staleBefore = now - 2 * 60 * 1000;
  const result = await db.prepare(
    `UPDATE deployment_states
     SET processing_event_type = ?, processing_started_at = ?, updated_at = ?
     WHERE connection_id = ? AND edgeone_deployment_id = ?
       AND (processing_event_type IS NULL OR processing_started_at < ?)`,
  ).bind(eventType, now, now, connectionId, edgeoneDeploymentId, staleBefore).run();
  return (result.meta.changes ?? 0) === 1;
}

export async function releaseDeploymentEvent(
  db: D1Database,
  connectionId: string,
  edgeoneDeploymentId: string,
  eventType: string,
): Promise<void> {
  await db.prepare(
    `UPDATE deployment_states SET processing_event_type = NULL, processing_started_at = NULL, updated_at = ?
     WHERE connection_id = ? AND edgeone_deployment_id = ? AND processing_event_type = ?`,
  ).bind(Date.now(), connectionId, edgeoneDeploymentId, eventType).run();
}

export async function completeDeploymentEvent(
  db: D1Database,
  state: DeploymentState,
  eventType: string,
): Promise<void> {
  await db.prepare(
    `UPDATE deployment_states
     SET check_run_id = ?, github_deployment_id = ?, last_event_type = ?,
         processing_event_type = NULL, processing_started_at = NULL, updated_at = ?
     WHERE connection_id = ? AND edgeone_deployment_id = ? AND processing_event_type = ?`,
  ).bind(
    state.checkRunId,
    state.githubDeploymentId,
    eventType,
    Date.now(),
    state.connectionId,
    state.edgeoneDeploymentId,
    eventType,
  ).run();
}
