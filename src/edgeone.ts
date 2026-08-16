import { constantTimeEqual, sha256Hex } from "./crypto";
import {
  createCommitStatus,
  createDeployment,
  createDeploymentStatus,
  findDeployment,
  getInstallationToken,
  resolveCommitSha,
  type DeploymentPresentation,
} from "./github";
import { jsonResponse, readBodyText } from "./http";
import {
  claimDeploymentEvent,
  completeDeploymentEvent,
  ensureDeploymentState,
  getConnectionByHook,
  getDeploymentState,
  releaseDeploymentEvent,
  updateDeploymentState,
  updateGitHubDeploymentId,
} from "./store";

const EDGEONE_EVENTS = new Set(["deployment.created", "deployment.succeeded", "deployment.failed"]);

interface EdgeOneEvent {
  eventType: DeploymentPresentation["eventType"];
  projectId: string;
  deploymentId: string;
  projectName: string;
  repoBranch: string;
  timestamp: number | string;
}

function parseEvent(raw: string): EdgeOneEvent | null {
  try {
    const value = JSON.parse(raw) as Partial<EdgeOneEvent>;
    if (
      typeof value.eventType !== "string"
      || !EDGEONE_EVENTS.has(value.eventType)
      || typeof value.projectId !== "string"
      || typeof value.deploymentId !== "string"
      || typeof value.repoBranch !== "string"
      || (typeof value.timestamp !== "string" && typeof value.timestamp !== "number")
    ) return null;
    return {
      eventType: value.eventType as EdgeOneEvent["eventType"],
      projectId: value.projectId,
      deploymentId: value.deploymentId,
      projectName: typeof value.projectName === "string" && value.projectName ? value.projectName : value.projectId,
      repoBranch: value.repoBranch,
      timestamp: value.timestamp,
    };
  } catch {
    return null;
  }
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return token && !token.includes(" ") ? token : null;
}

function isStaleTerminalTransition(previous: string, current: string): boolean {
  return (previous === "deployment.succeeded" || previous === "deployment.failed") && current === "deployment.created";
}

export async function handleEdgeOneWebhook(request: Request, env: Env, hookId: string): Promise<Response> {
  const connection = await getConnectionByHook(env.DB, hookId);
  if (!connection) return jsonResponse({ error: "Connection not found" }, 404);

  const token = bearerToken(request);
  if (!token) return jsonResponse({ error: "Bearer token required" }, 401);
  const presentedHash = await sha256Hex(token);
  if (!constantTimeEqual(presentedHash, connection.tokenHash)) return jsonResponse({ error: "Invalid bearer token" }, 401);

  const event = parseEvent(await readBodyText(request, 64 * 1024));
  if (!event) return jsonResponse({ error: "Invalid EdgeOne webhook payload" }, 400);
  if (event.projectId !== connection.edgeoneProjectId) return jsonResponse({ error: "Project does not match this connection" }, 409);
  if (event.repoBranch !== connection.branch) return jsonResponse({ error: "Branch does not match this connection" }, 409);

  const [installationToken, existingState] = await Promise.all([
    getInstallationToken(env, connection.installationId),
    getDeploymentState(env.DB, connection.id, event.deploymentId),
  ]);
  const stateWasCreated = !existingState;
  let state = existingState;
  if (!state) {
    const initialSha = await resolveCommitSha(
      installationToken,
      connection.repositoryOwner,
      connection.repositoryName,
      connection.branch,
    );
    state = await ensureDeploymentState(env.DB, connection.id, event.deploymentId, initialSha);
  }

  if (state.lastEventType === event.eventType || isStaleTerminalTransition(state.lastEventType, event.eventType)) {
    return jsonResponse({ ok: true, duplicate: true, headSha: state.headSha });
  }

  const claimed = await claimDeploymentEvent(env.DB, connection.id, event.deploymentId, event.eventType);
  if (!claimed) return jsonResponse({ error: "Deployment event is already being processed" }, 503);

  const detailsUrl = `https://console.cloud.tencent.com/edgeone/makers/project/${encodeURIComponent(event.projectId)}/deployment/${encodeURIComponent(event.deploymentId)}`;
  const presentation: DeploymentPresentation = {
    eventType: event.eventType,
    deploymentId: event.deploymentId,
    detailsUrl,
    projectName: event.projectName,
  };

  try {
    const commitStatus = async (): Promise<void> => {
      if (!connection.checksEnabled) return;
      await createCommitStatus(
        installationToken,
        connection.repositoryOwner,
        connection.repositoryName,
        state.headSha,
        presentation,
      );
    };

    const deployment = async (): Promise<number | null> => {
      if (!connection.deploymentsEnabled) return state.githubDeploymentId;
      let githubDeploymentId = state.githubDeploymentId ?? (stateWasCreated ? null : await findDeployment(
        installationToken,
        connection.repositoryOwner,
        connection.repositoryName,
        state.headSha,
        connection.environment,
        event.deploymentId,
      ));
      if (!githubDeploymentId) {
        githubDeploymentId = await createDeployment(
          installationToken,
          connection.repositoryOwner,
          connection.repositoryName,
          state.headSha,
          connection.environment,
          presentation,
        );
        state.githubDeploymentId = githubDeploymentId;
        await updateGitHubDeploymentId(env.DB, state.connectionId, state.edgeoneDeploymentId, githubDeploymentId);
      }
      await createDeploymentStatus(
        installationToken,
        connection.repositoryOwner,
        connection.repositoryName,
        githubDeploymentId,
        connection.environment,
        presentation,
      );
      return githubDeploymentId;
    };

    const [, githubDeploymentId] = await Promise.all([commitStatus(), deployment()]);
    state.githubDeploymentId = githubDeploymentId;

    await updateDeploymentState(env.DB, state);
    await completeDeploymentEvent(env.DB, state, event.eventType);
    return jsonResponse({ ok: true, headSha: state.headSha });
  } catch (error) {
    await releaseDeploymentEvent(env.DB, connection.id, event.deploymentId, event.eventType);
    throw error;
  }
}

export const testables = { parseEvent, bearerToken, isStaleTerminalTransition };
