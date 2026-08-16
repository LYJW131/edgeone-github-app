<div align="right">English · <a href="README.md">中文</a></div>

# EdgeOne Deploy Checker

Report Tencent Cloud EdgeOne Pages (Makers) deployments back to GitHub.

Every EdgeOne build shows up as an `EdgeOne Makers` status check on the matching commit and as an entry on the repository's Deployments page, with a **Details** link straight to the deployment in the Tencent Cloud console. Site code, build commands, and GitHub Actions all stay untouched.

- Hosted service: [eo-deploy-checker.lyjw.dev](https://eo-deploy-checker.lyjw.dev)
- GitHub App: [EdgeOne Deploy Checker](https://github.com/apps/edgeone-deploy-checker)

There are two ways to use it: the hosted App above, or your own deployment on your Cloudflare account. The hosted App works with personal accounts and organizations, and only gets access to the repositories you select at install time.

## Use the hosted app

### Before you start

You need:

- a GitHub repository already connected to an EdgeOne Pages / Makers project;
- permission to install a GitHub App on that repository or organization;
- permission to edit **EdgeOne Pages / Makers → Settings → Webhooks** in the Tencent Cloud console;
- the EdgeOne project ID, such as `makers-vd4b9ycpaa0n`.

The project ID is the `makers-...` segment of an EdgeOne project URL:

```text
https://console.cloud.tencent.com/edgeone/makers/project/makers-vd4b9ycpaa0n/...
                                                        └──── project ID ────┘
```

### 1. Install the GitHub App

Open the [setup page](https://eo-deploy-checker.lyjw.dev/setup) and select **Install on GitHub**, or go straight to the [GitHub installation page](https://github.com/apps/edgeone-deploy-checker/installations/new).

1. Choose the account or organization that owns the repository.
2. Prefer **Only select repositories**, and select just the repositories that should receive deployment statuses.
3. Finish the installation and authorize the setup page when GitHub asks.

GitHub redirects back to the setup page. If authorization expires or the flow is interrupted, reopen the [setup page](https://eo-deploy-checker.lyjw.dev/setup) and start again.

### 2. Create a connection

Fill in the setup form:

| Field | What to enter |
| --- | --- |
| Repository | The GitHub repository the EdgeOne project deploys |
| EdgeOne project ID | The exact `makers-...` project ID |
| Deployment branch | The branch EdgeOne builds, usually `main` |
| GitHub environment | Use `EdgeOne Production` |
| Create GitHub commit status | Keep enabled to show `EdgeOne Makers` on commits |
| Create GitHub Deployments | Keep enabled to populate the Deployments page |

> If Vercel or another provider also reports deployments to the same repository, do not keep the default `Production` environment name. GitHub groups deployments by the exact environment string, so a shared name mixes providers together.

Select **Create connection**. The next page shows two values, once only:

- a unique **Webhook URL**;
- a unique **Secret token**.

Copy both with the **Copy** buttons beside them. The service stores only a digest of the token, so the raw value cannot be shown again.

### 3. Configure the EdgeOne webhook

In the Tencent Cloud console, open **EdgeOne Pages / Makers → Settings → Webhooks**:

1. Select the matching EdgeOne project.
2. Paste the **Webhook URL** into **Endpoint**.
3. Paste the **Secret token** into the field of the same name, verbatim.
4. Subscribe to three events: `deployment.created`, `deployment.succeeded`, `deployment.failed`.
5. Save.

EdgeOne sends the token as an HTTP bearer credential, so enter the token by itself — no `Bearer`, quotes, or surrounding whitespace.

### 4. Verify

Trigger a deployment for the configured branch in EdgeOne. A working connection produces:

- an **EdgeOne Makers** status on the commit, moving from pending to success or failure;
- a **Details** link that opens the matching deployment in the Tencent Cloud console;
- an entry under **Deployments → EdgeOne Production** in the repository.

### Manage and remove connections

Return to the [setup page](https://eo-deploy-checker.lyjw.dev/setup) to view or delete the connections belonging to the current installation.

- **Rotate a token:** delete the connection, recreate it, then immediately update the URL and token in Tencent Cloud. EdgeOne retries non-2xx responses, so do not rotate while deployment events are still being delivered.
- **Add or remove repositories:** change the GitHub App installation settings for that account; the service cleans up connections for removed repositories automatically.
- **Remove everything:** uninstall the GitHub App, which deletes all configuration for that installation.

## Self-hosting

Running this on your own Cloudflare account means creating your own GitHub App and deploying the Worker. Use a staging App to get the flow working first — GitHub does not support converting an existing private App to a public one.

### 1. Create a GitHub App

Open **GitHub Settings → Developer settings → GitHub Apps → New GitHub App**:

| Setting | Value |
| --- | --- |
| GitHub App name | A globally unique name |
| Homepage URL | Your project or documentation URL |
| Callback URL | `https://YOUR_DOMAIN/auth/github/callback` |
| Setup URL | `https://YOUR_DOMAIN/setup` |
| Redirect on update | Enabled |
| Request user authorization during installation | Disabled |
| Webhook URL | `https://YOUR_DOMAIN/github/webhook` |
| Webhook secret | A newly generated random value |
| Where can this GitHub App be installed? | Any account |

Repository permissions:

| Permission | Level |
| --- | --- |
| Commit statuses | Read and write |
| Contents | Read-only |
| Deployments | Read and write |
| Metadata | Read-only (mandatory) |

GitHub delivers the installation lifecycle events used for cleanup automatically; they are not selectable in the event list.

After creating the App, record the **Client ID**, generate and record a **Client Secret**, then generate a **Private key**.

GitHub downloads an RSA key in PKCS#1 form, but the Worker's Web Crypto API imports PKCS#8. Convert it locally:

```bash
openssl pkcs8 -topk8 -nocrypt -in downloaded-key.pem -out github-app-pkcs8.pem
```

Never commit either private-key file.

### 2. Create Cloudflare resources

Install dependencies and authenticate Wrangler:

```bash
pnpm install
pnpm wrangler login
```

Create the D1 database and let Wrangler update the existing `DB` binding:

```bash
pnpm wrangler d1 create edgeone-github-app --binding DB --update-config
```

Confirm that a `database_id` was added to the existing D1 entry in `wrangler.jsonc`; if your Wrangler version does not update it, copy the returned ID in manually. Then set `vars`:

- `PUBLIC_BASE_URL`: the Worker's public HTTPS origin, with no trailing slash;
- `GITHUB_APP_SLUG`: the slug from `https://github.com/apps/<slug>`.

Apply the migration:

```bash
pnpm db:remote
```

### 3. Store secrets

Generate `OAUTH_STATE_SECRET` and the GitHub App webhook secret with a cryptographically secure generator, for example:

```bash
openssl rand -base64 32
```

Store each value interactively:

```bash
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET
pnpm wrangler secret put GITHUB_APP_PRIVATE_KEY
pnpm wrangler secret put GITHUB_WEBHOOK_SECRET
pnpm wrangler secret put OAUTH_STATE_SECRET
```

Two things to watch:

- `GITHUB_APP_PRIVATE_KEY` must be the entire PKCS#8 PEM, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines;
- `GITHUB_WEBHOOK_SECRET` must match the **Webhook secret** in the GitHub App settings exactly.

### 4. Deploy and verify

```bash
pnpm test
pnpm typecheck
pnpm deploy:dry
pnpm deploy
```

For a custom domain: add it to the Worker in Cloudflare, point `PUBLIC_BASE_URL` at it, redeploy, and make sure the GitHub App's Callback, Setup, and Webhook URLs all use that same canonical origin.

Once deployed, check `https://YOUR_DOMAIN/health`. A healthy Worker responds with:

```json
{"ok":true,"service":"edgeone-github-app"}
```

### 5. Connect an EdgeOne project

Install your own GitHub App on a test repository; GitHub redirects to your setup page. Everything after that is identical to the hosted flow — follow "Create a connection → Configure the EdgeOne webhook → Verify → Manage and remove connections" under [Use the hosted app](#use-the-hosted-app), substituting your own domain for the hosted URL.

## How it works and security model

```text
EdgeOne project ──── bearer-auth webhook ────▶ Cloudflare Worker
                                                    │
                                                    ├──▶ GitHub commit status
                                                    ├──▶ GitHub Deployment + status
                                                    └──▶ D1 (tenant config, deployment state)

GitHub App install ── user OAuth verification ──▶ setup page
GitHub App events ── HMAC-signed webhook ───────▶ uninstall and repository cleanup
```

A **connection** is the smallest unit of configuration and isolation:

```text
GitHub installation + repository + EdgeOne project + branch + GitHub environment
```

Each connection gets a random webhook identifier and its own 256-bit bearer token.

### Security

- **Tokens are never stored.** D1 keeps only the SHA-256 digest, compared in constant time. The webhook URL is not treated as a secret; the bearer token is the credential.
- **Setup does not trust URL parameters.** The `installation_id` GitHub passes to a Setup URL can be spoofed, so the setup flow always requires user OAuth: it exchanges the code for a request-local user token, verifies the installation ID through `/user/installations`, and only then creates an eight-hour setup session. The setup page lists repositories using an installation token and never exposes GitHub credentials to the browser.
- **GitHub webhooks are verified.** `/github/webhook` checks `X-Hub-Signature-256` as an HMAC over the raw request body. `installation.deleted` and repository-removal events delete the matching connections, and deployment state cascades via foreign keys.
- **Credentials are not persisted.** GitHub installation tokens and user access tokens are request-local. Logs deliberately omit request bodies, authorization headers, OAuth codes, and tokens.
- Encrypted secrets required by the Worker: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (PKCS#8 PEM), `GITHUB_WEBHOOK_SECRET`, `OAUTH_STATE_SECRET`.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

### Idempotency and concurrency

- The primary key `(connection_id, edgeone_deployment_id)` keeps one EdgeOne deployment pinned to one GitHub SHA across retries.
- An atomic D1 claim serializes concurrent events for the same deployment. A failed attempt releases its claim, and a ten-second lease lets EdgeOne retry if it cancels a request mid-flight.
- A repeated event matching `last_event_type` returns success without a second write to GitHub.
- Commit statuses use the stable `EdgeOne Makers` context, so GitHub shows only the latest state for the commit; GitHub Deployment IDs are persisted and reused for later status updates.

## Current limitations

- **One active connection per EdgeOne account.** EdgeOne currently exposes a single outbound webhook configuration for the whole Pages / Makers account rather than one per project, so connecting another project means replacing the account-level endpoint and token. Separate Tencent Cloud accounts are unaffected. Supporting several projects from one account would require a shared account-level endpoint that routes events to per-project connections.
- **The payload carries no commit SHA.** EdgeOne only provides `repoBranch`. The service resolves the branch head through GitHub on a deployment's first event and reuses that SHA afterwards. If the branch advances between the push and that first webhook, the resolved commit can theoretically differ from the one actually built. Should EdgeOne add a SHA later, it should take precedence, keeping branch-head resolution as the fallback.

## Local development

```bash
cp .dev.vars.example .dev.vars
pnpm install
pnpm db:local
pnpm dev
```

Run the full validation suite before committing:

```bash
pnpm test
pnpm typecheck
pnpm deploy:dry
```

## References

- [GitHub: About the setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)
- [GitHub: Using webhooks with a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps)
- [Cloudflare: Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Tencent Cloud: EdgeOne Pages Webhook](https://cloud.tencent.com/document/product/1552/127680)

## License

[MIT](LICENSE)
