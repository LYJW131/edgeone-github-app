# EdgeOne GitHub App

Bridge Tencent Cloud EdgeOne Pages/Makers deployment webhooks into GitHub Checks and GitHub Deployments.

This repository is a multi-tenant Cloudflare Worker intended to back a public GitHub App. Each installation can connect one or more repositories to EdgeOne projects without adding CI files or provider-specific code to those repositories.

## What it does

- shows `EdgeOne Makers` as a check on the commit EdgeOne is building;
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
                                               ├── GitHub Check Run
                                               ├── GitHub Deployment + status
                                               └── D1 tenant/deployment state

GitHub App setup ── user OAuth verification ──▶ setup UI
GitHub App events ── HMAC-auth webhook ────────▶ installation cleanup
```

## Start here

- [Architecture and security model](docs/architecture.md)
- [Create the GitHub App and deploy the Worker](docs/operator-setup.md)

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
