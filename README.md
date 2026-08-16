# EdgeOne Deploy Checker

Report Tencent Cloud EdgeOne Pages/Makers deployments back to GitHub as commit checks and GitHub Deployments. Repository code, CI workflows, and EdgeOne build commands do not need to change.

## Use the hosted version

The hosted service runs at [eo-deploy-checker.lyjw.dev](https://eo-deploy-checker.lyjw.dev) and uses the public GitHub App [EdgeOne Deploy Checker](https://github.com/apps/edgeone-deploy-checker). It can be installed on personal accounts and organizations; the App only receives access to the repositories selected during installation.

### Before you start

You need:

- a GitHub repository that is already connected to an EdgeOne Pages/Makers project;
- permission to install a GitHub App on that repository;
- permission to edit **EdgeOne Pages/Makers → Settings → Webhooks** in the Tencent Cloud console;
- the EdgeOne project ID, such as `makers-vd4b9ycpaa0n`.

The project ID is the `makers-...` value in an EdgeOne project URL:

```text
https://console.cloud.tencent.com/edgeone/makers/project/makers-vd4b9ycpaa0n/...
                                                        └──── project ID ────┘
```

### 1. Install the GitHub App

Open the [hosted setup page](https://eo-deploy-checker.lyjw.dev/setup) and select **Install on GitHub**, or open the [GitHub installation page](https://github.com/apps/edgeone-deploy-checker/installations/new) directly.

1. Choose the GitHub account or organization that owns the repository.
2. Prefer **Only select repositories**, then select each repository that EdgeOne may report deployments to.
3. Finish the installation and authorize the setup page when GitHub asks.

GitHub redirects back to the hosted setup page. If authorization expires or is interrupted, return to [the setup page](https://eo-deploy-checker.lyjw.dev/setup) and restart the flow.

### 2. Create a connection

On the setup page, fill in:

| Field | What to enter |
| --- | --- |
| Repository | The repository deployed by the EdgeOne project |
| EdgeOne project ID | The exact `makers-...` project ID from Tencent Cloud |
| Deployment branch | The branch EdgeOne builds, usually `main` |
| GitHub environment | Replace the prefilled `Production` with `EdgeOne Production` |
| Create GitHub commit status | Keep enabled to show `EdgeOne Makers` on commits with a direct EdgeOne details link |
| Create GitHub Deployments | Keep enabled to populate the repository Deployments page |

Use a separate environment name such as `EdgeOne Production` instead of `Production` when Vercel or another provider also reports to GitHub. GitHub groups deployments by the exact environment string; using `Production` for both providers mixes them together.

Select **Create connection**. The next page displays two values:

- a unique **Webhook URL**;
- a unique **Secret token**.

Copy both immediately. The raw token is shown only once and is not stored by the service.

### 3. Configure the EdgeOne webhook

In the Tencent Cloud console, open **EdgeOne Pages/Makers → Settings → Webhooks** and configure the outbound webhook:

1. Set the scope to the relevant project and select the same EdgeOne project used above.
2. Paste the generated **Webhook URL** into **Endpoint**.
3. Paste the generated **Secret token** into **Secret token**.
4. Enable all three deployment events:
   - `deployment.created`
   - `deployment.succeeded`
   - `deployment.failed`
5. Save the webhook.

EdgeOne sends the token as an HTTP bearer credential. Do not add `Bearer`, quotes, or other text around the value in the Tencent Cloud field.

### 4. Verify the integration

Trigger a deployment for the configured branch in EdgeOne. A working connection produces:

- an **EdgeOne Makers** status on the commit, initially pending and then successful or failed;
- a GitHub Deployment under **Repository → Deployments → EdgeOne Production**;
- a **Details** link back to the matching deployment in the Tencent Cloud console.

No GitHub Actions workflow or repository-specific integration code is required.

### Manage or remove a connection

Return to [the hosted setup page](https://eo-deploy-checker.lyjw.dev/setup) to view or delete connections available to the current installation.

- To rotate a connection token, delete and recreate the connection, then immediately replace the URL and token in Tencent Cloud.
- To add or remove repositories, open the GitHub App installation settings for the account.
- Uninstalling the GitHub App removes the installation's tenant configuration from the hosted service.

## Current limitation

EdgeOne currently provides one outbound Webhook configuration for the whole Pages/Makers account. Therefore, one Tencent Cloud account can have only one active connection with this version at a time. Creating another connection for the same EdgeOne account replaces the account-level webhook destination. Different Tencent Cloud accounts remain isolated and can use the hosted service independently.

## What the service does

- shows `EdgeOne Makers` as a commit status whose **Details** link opens the matching EdgeOne deployment;
- creates and updates a GitHub Deployment for the configured environment;
- verifies that setup was started by a GitHub user who can access the installation;
- gives every repository/project connection its own unguessable webhook URL and bearer token;
- verifies GitHub App webhooks and removes tenant data when the App is uninstalled;
- keeps tenant configuration and deployment state in Cloudflare D1.

EdgeOne's webhook currently identifies a branch but does not include a commit SHA. The first event therefore resolves the configured branch head through GitHub; later events keep using that recorded SHA.

## Architecture

```text
EdgeOne project ── bearer-auth webhook ──▶ Cloudflare Worker
                                               │
                                               ├── GitHub commit status
                                               ├── GitHub Deployment + status
                                               └── D1 tenant/deployment state

GitHub App setup ── user OAuth verification ──▶ setup UI
GitHub App events ── HMAC-auth webhook ────────▶ installation cleanup
```

## Self-hosting and development

- [Architecture and security model](docs/architecture.md)
- [Create your own GitHub App and deploy the Worker](docs/operator-setup.md)

For local development:

```bash
cp .dev.vars.example .dev.vars
pnpm install
pnpm db:local
pnpm dev
```

Run the validation suite with:

```bash
pnpm test
pnpm typecheck
pnpm deploy:dry
```

## License

[MIT](LICENSE)
