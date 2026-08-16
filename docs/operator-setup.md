# Operator setup

This guide creates a new public GitHub App and deploys its backend to Cloudflare Workers. Use a staging App first; changing an existing private App to public is not supported by GitHub.

## 1. Create a GitHub App

Open **GitHub settings → Developer settings → GitHub Apps → New GitHub App** and configure:

| Setting | Value |
| --- | --- |
| GitHub App name | A globally unique public name |
| Homepage URL | Your project or documentation URL |
| Callback URL | `https://YOUR_WORKER/auth/github/callback` |
| Setup URL | `https://YOUR_WORKER/setup` |
| Redirect on update | Enabled |
| Request user authorization during installation | Disabled |
| Webhook URL | `https://YOUR_WORKER/github/webhook` |
| Webhook secret | A new random value |
| Where can this GitHub App be installed? | Any account |

Repository permissions:

- **Commit statuses:** Read and write
- **Contents:** Read-only
- **Deployments:** Read and write
- **Metadata:** Read-only (mandatory)

GitHub delivers the installation lifecycle events used for cleanup automatically; they are not selectable in the GitHub App event list.

Generate a private key and record the App's Client ID and Client Secret.

GitHub downloads an RSA key in PKCS#1 form. The Worker Web Crypto API imports PKCS#8, so convert it locally:

```bash
openssl pkcs8 -topk8 -nocrypt -in downloaded-key.pem -out github-app-pkcs8.pem
```

Never commit either private-key file.

## 2. Create Cloudflare resources

Install dependencies and authenticate Wrangler:

```bash
pnpm install
pnpm wrangler login
```

Create D1 and ask Wrangler to update the existing `DB` binding:

```bash
pnpm wrangler d1 create edgeone-github-app --binding DB --update-config
```

Confirm that Wrangler added a `database_id` to the existing D1 entry in `wrangler.jsonc`. If your Wrangler version does not update it, copy the returned ID manually. Set `PUBLIC_BASE_URL` and `GITHUB_APP_SLUG` to the deployed values, then apply the migration:

```bash
pnpm db:remote
```

## 3. Store secrets

Generate the state-signing secret and the GitHub webhook secret with a cryptographically secure generator, for example:

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

For `GITHUB_APP_PRIVATE_KEY`, paste the entire PKCS#8 PEM including its header and footer.

## 4. Validate and deploy

```bash
pnpm test
pnpm typecheck
pnpm deploy:dry
pnpm deploy
```

If you use a custom domain, add it in Cloudflare, update `PUBLIC_BASE_URL`, redeploy, and ensure the GitHub App Callback, Setup, and Webhook URLs use the same canonical origin.

Check `https://YOUR_WORKER/health`, then install the GitHub App on a test repository. GitHub should redirect to the setup page.

## 5. Connect an EdgeOne project

On the setup page:

1. choose a repository;
2. enter the exact EdgeOne project ID;
3. enter the branch EdgeOne deploys;
4. choose the GitHub Deployment environment name;
5. create the connection.

The Worker displays a unique webhook URL and secret token once, with a copy button beside each value. In **Makers → Settings → Webhooks**, select the project, enable the three deployment events, paste the URL into **Endpoint**, and paste the raw token into **Secret token**. EdgeOne sends it as:

```text
Authorization: Bearer THE_GENERATED_TOKEN
```

Subscribe to `deployment.created`, `deployment.succeeded`, and `deployment.failed`. EdgeOne retries non-2xx responses, so do not rotate or delete the connection while a deployment is being delivered.

EdgeOne currently exposes one outbound Webhook configuration for the whole Makers account. This version therefore supports one active connection per EdgeOne account; creating another connection requires replacing the account-level endpoint and token.

## 6. Rotation and removal

Delete and recreate a connection to rotate its bearer token. Update EdgeOne immediately after rotation. Uninstalling the GitHub App or removing a repository from the installation triggers cleanup through the signed GitHub webhook.

## References

- [GitHub: About the setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)
- [GitHub: Using webhooks with a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps)
- [Cloudflare: Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Tencent Cloud: EdgeOne Pages Webhook](https://cloud.tencent.com/document/product/1552/127680)
