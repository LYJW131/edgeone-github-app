# Architecture and security model

## Tenant boundary

A connection is the smallest unit of configuration:

```text
GitHub installation + repository + EdgeOne project + branch + environment
```

Every connection receives a random webhook identifier and an independent 256-bit bearer token. The webhook URL is not treated as a secret; the bearer token is. Only its SHA-256 digest is stored in D1.

Installation access is never inferred from an `installation_id` query parameter. GitHub warns that the value sent to a Setup URL can be spoofed. The setup flow therefore requires GitHub user authorization, exchanges the callback code for a short-lived user token, and verifies the requested installation through GitHub's user-installations API before creating a setup session.

## Request flows

### App installation and setup

1. GitHub redirects the installer to `/setup?installation_id=...`.
2. The Worker creates a signed OAuth state bound to the installation and an HttpOnly nonce cookie.
3. GitHub redirects to `/auth/github/callback` after the user authorizes the App.
4. The Worker exchanges the code for a request-local user token, lists the installations accessible to that token through `/user/installations`, and requires an exact installation ID match.
5. A random, eight-hour setup session is stored as a digest in D1 and set in an HttpOnly cookie.
6. The setup UI uses an installation token to list selectable repositories. It never exposes GitHub credentials.

### EdgeOne deployment

1. EdgeOne sends a deployment webhook to `/edgeone/:hookId` with `Authorization: Bearer ...`.
2. The Worker performs bounded parsing, hashes the token, and compares it in constant time.
3. It checks the configured project and branch, then resolves the branch head on the first event.
4. It publishes a GitHub commit status with a direct EdgeOne details link and creates or updates a GitHub Deployment status.
5. D1 records the chosen SHA and remote object IDs. Repeated delivery of the same event is idempotent.

### GitHub App webhook

GitHub sends lifecycle events to `/github/webhook`. The Worker verifies `X-Hub-Signature-256` over the raw request body. `installation.deleted` and repository-removal events delete the corresponding connection rows, whose deployment state cascades.

## Secrets

The Worker requires these encrypted secrets:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_APP_PRIVATE_KEY` (PKCS#8 PEM)
- `GITHUB_WEBHOOK_SECRET`
- `OAUTH_STATE_SECRET`

GitHub installation tokens and user access tokens are request-local and are never persisted. Logs intentionally omit request bodies, authorization headers, OAuth codes, and tokens.

## Idempotency

- The D1 primary key `(connection_id, edgeone_deployment_id)` stabilizes the commit SHA across retries.
- An atomic D1 claim serializes concurrent deliveries. A failed attempt releases its claim, and a ten-second lease lets EdgeOne recover if it cancels an in-flight request before the Worker can release it.
- A repeated EdgeOne event matching `last_event_type` returns success without a second GitHub write.
- Commit statuses use the stable `EdgeOne Makers` context; GitHub displays the latest state for the commit and sends its **Details** link directly to EdgeOne.
- GitHub Deployment IDs are persisted and reused for later status updates.

## Current provider limitation

The documented EdgeOne Makers webhook payload contains `repoBranch` but no commit SHA. A branch can advance between a push and EdgeOne's first webhook, so the resolved head can theoretically differ from the exact build commit. If EdgeOne adds a commit SHA later, it should become the authoritative value while retaining the branch-head fallback.

EdgeOne Makers also currently exposes one outbound Webhook configuration for an entire account rather than one per project. Because this version issues credentials per connection, an EdgeOne account can have one active connection at a time. Supporting several projects from one EdgeOne account requires grouping connections behind a shared account-level hook and credential.
