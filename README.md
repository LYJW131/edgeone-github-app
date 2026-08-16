<div align="right"><strong>中文</strong> · <a href="README.en.md">English</a></div>

# EdgeOne Deploy Checker

把腾讯云 EdgeOne Pages（Makers）的部署状态同步回 GitHub。

每次 EdgeOne 构建时，对应提交上会出现一个 `EdgeOne Makers` 状态检查，仓库的 Deployments 页面也会留下一条部署记录，点 **Details** 直达腾讯云的部署详情页。站点代码、构建命令和 GitHub Actions 都不需要改动。

- 托管服务：[eo-deploy-checker.lyjw.dev](https://eo-deploy-checker.lyjw.dev)
- GitHub App：[EdgeOne Deploy Checker](https://github.com/apps/edgeone-deploy-checker)

有两种用法：直接用上面的托管 App，或者自行部署一套到你的 Cloudflare 账号。托管 App 支持个人账号和组织，安装时勾选了哪些仓库，它就只能访问哪些仓库。

## 使用托管 App

### 开始之前

你需要：

- 一个已连接 EdgeOne Pages / Makers 项目的 GitHub 仓库；
- 在该仓库或组织安装 GitHub App 的权限；
- 修改腾讯云 **EdgeOne Pages / Makers → 设置 → Webhook** 的权限；
- EdgeOne 项目 ID，形如 `makers-vd4b9ycpaa0n`。

项目 ID 就是腾讯云控制台地址里 `makers-` 开头的那一段：

```text
https://console.cloud.tencent.com/edgeone/makers/project/makers-vd4b9ycpaa0n/...
                                                        └──── 项目 ID ────┘
```

### 1. 安装 GitHub App

打开[设置页](https://eo-deploy-checker.lyjw.dev/setup)点击 **Install on GitHub**，或直接打开 [GitHub 安装页](https://github.com/apps/edgeone-deploy-checker/installations/new)。

1. 选择仓库所属的个人账号或组织。
2. 建议选 **Only select repositories**，只勾选需要接收部署状态的仓库。
3. 完成安装，并在 GitHub 提示时授权设置页。

装完 GitHub 会自动跳回设置页。如果授权过期或中途退出，重新打开[设置页](https://eo-deploy-checker.lyjw.dev/setup)再走一遍即可。

### 2. 创建连接

在设置页填写：

| 字段 | 填写内容 |
| --- | --- |
| Repository | EdgeOne 项目所部署的 GitHub 仓库 |
| EdgeOne project ID | 完整的 `makers-...` 项目 ID |
| Deployment branch | EdgeOne 实际构建的分支，通常是 `main` |
| GitHub environment | 建议填 `EdgeOne Production` |
| Create GitHub commit status | 建议开启，在提交上显示 `EdgeOne Makers` |
| Create GitHub Deployments | 建议开启，在 Deployments 页面留下记录 |

> 如果 Vercel 等其他平台也会向同一个仓库上报部署，环境名就不要沿用默认的 `Production`。GitHub 按环境名归类，重名会把不同平台的部署混在一起。

点击 **Create connection**，页面会显示两个值，且只显示这一次：

- 专属的 **Webhook URL**；
- 专属的 **Secret token**。

用旁边的 **Copy** 按钮分别复制保存。服务只存令牌摘要，原始令牌无法再次查看。

### 3. 配置 EdgeOne Webhook

进入腾讯云 **EdgeOne Pages / Makers → 设置 → Webhook**：

1. 选择对应的 EdgeOne 项目。
2. 把 **Webhook URL** 粘贴到 **Endpoint**。
3. 把 **Secret token** 原样粘贴到同名字段。
4. 订阅三个事件：`deployment.created`、`deployment.succeeded`、`deployment.failed`。
5. 保存。

EdgeOne 会自动把令牌作为 HTTP Bearer 凭据发送，所以腾讯云的字段里只填令牌本身，不要加 `Bearer`、引号或空格。

### 4. 验证

在 EdgeOne 上触发一次目标分支的部署。连接正常时可以看到：

- 对应提交出现 **EdgeOne Makers** 状态，并从 pending 变成 success 或 failure；
- 点击该状态的 **Details** 直接打开腾讯云对应的部署页；
- 仓库的 **Deployments → EdgeOne Production** 出现一条部署记录。

### 管理与删除连接

回到[设置页](https://eo-deploy-checker.lyjw.dev/setup)可以查看和删除当前安装下的连接。

- **轮换令牌**：删除连接后重新创建，然后立刻在腾讯云更新 URL 和令牌。EdgeOne 会重试非 2xx 响应，所以不要在部署事件还在投递时轮换。
- **增删仓库**：在该账号的 GitHub App 安装设置里调整，服务会自动清理被移除仓库的连接。
- **彻底移除**：卸载 GitHub App，该安装的全部配置随之删除。

## 自行部署

要跑在自己的 Cloudflare 账号上，需要自建一个 GitHub App 并部署 Worker。建议先用一个测试 App 走通全流程——GitHub 不支持把已有的私有 App 改成公开 App。

### 1. 创建 GitHub App

进入 **GitHub Settings → Developer settings → GitHub Apps → New GitHub App**：

| 设置项 | 填写内容 |
| --- | --- |
| GitHub App name | 一个全局唯一的名称 |
| Homepage URL | 项目主页或文档地址 |
| Callback URL | `https://你的域名/auth/github/callback` |
| Setup URL | `https://你的域名/setup` |
| Redirect on update | 开启 |
| Request user authorization during installation | 关闭 |
| Webhook URL | `https://你的域名/github/webhook` |
| Webhook secret | 一枚新生成的随机值 |
| Where can this GitHub App be installed? | Any account |

Repository permissions：

| 权限 | 级别 |
| --- | --- |
| Commit statuses | Read and write |
| Contents | Read-only |
| Deployments | Read and write |
| Metadata | Read-only（GitHub 强制要求） |

用于清理的安装生命周期事件由 GitHub 自动投递，不需要在事件列表里额外勾选。

创建完成后，记下 **Client ID**，生成并记下 **Client Secret**，再生成一枚 **Private key**。

GitHub 下载的 RSA 私钥是 PKCS#1 格式，而 Worker 的 Web Crypto 只能导入 PKCS#8，需要在本机转换：

```bash
openssl pkcs8 -topk8 -nocrypt -in downloaded-key.pem -out github-app-pkcs8.pem
```

两份私钥文件都不要提交进 Git。

### 2. 准备 Cloudflare 资源

安装依赖并登录 Wrangler：

```bash
pnpm install
pnpm wrangler login
```

创建 D1 数据库，并让 Wrangler 更新现有的 `DB` binding：

```bash
pnpm wrangler d1 create edgeone-github-app --binding DB --update-config
```

确认 `wrangler.jsonc` 里的 D1 配置已经写入 `database_id`；如果当前 Wrangler 版本没有自动写入，就把命令返回的 ID 手动填进去。同时修改 `vars`：

- `PUBLIC_BASE_URL`：Worker 的公开 HTTPS 根地址，不带末尾斜杠；
- `GITHUB_APP_SLUG`：GitHub App 地址 `https://github.com/apps/<slug>` 里的 slug。

然后应用数据库迁移：

```bash
pnpm db:remote
```

### 3. 写入 Secrets

`OAUTH_STATE_SECRET` 和 GitHub App 的 Webhook secret 都要用密码学安全的随机源生成，例如：

```bash
openssl rand -base64 32
```

逐项写入 Cloudflare：

```bash
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET
pnpm wrangler secret put GITHUB_APP_PRIVATE_KEY
pnpm wrangler secret put GITHUB_WEBHOOK_SECRET
pnpm wrangler secret put OAUTH_STATE_SECRET
```

两点注意：

- `GITHUB_APP_PRIVATE_KEY` 要粘贴完整的 PKCS#8 PEM，包含 `-----BEGIN PRIVATE KEY-----` 和 `-----END PRIVATE KEY-----` 两行；
- `GITHUB_WEBHOOK_SECRET` 必须和 GitHub App 设置页里的 **Webhook secret** 完全一致。

### 4. 部署并验证

```bash
pnpm test
pnpm typecheck
pnpm deploy:dry
pnpm deploy
```

使用自定义域名时：在 Cloudflare 为 Worker 绑定域名，把 `PUBLIC_BASE_URL` 改成该域名后重新部署，并确认 GitHub App 的 Callback URL、Setup URL、Webhook URL 都指向同一个正式域名。

部署完成后访问 `https://你的域名/health`，正常响应是：

```json
{"ok":true,"service":"edgeone-github-app"}
```

### 5. 连接 EdgeOne 项目

把自建的 GitHub App 安装到一个测试仓库，GitHub 会跳转到你自己的设置页。之后的步骤和托管版完全一样，按[使用托管 App](#使用托管-app) 里的「创建连接 → 配置 EdgeOne Webhook → 验证 → 管理与删除连接」操作即可，只是把托管地址换成你的域名。

## 工作原理与安全模型

```text
EdgeOne 项目 ──── Bearer 鉴权 Webhook ────▶ Cloudflare Worker
                                                 │
                                                 ├──▶ GitHub Commit Status
                                                 ├──▶ GitHub Deployment + Status
                                                 └──▶ D1（租户配置与部署状态）

GitHub App 安装 ── 用户 OAuth 校验 ──────────▶ 设置页
GitHub App 事件 ── HMAC 签名 Webhook ────────▶ 卸载与仓库移除清理
```

一个**连接**是配置与隔离的最小单元：

```text
GitHub App 安装 + 仓库 + EdgeOne 项目 + 分支 + GitHub 环境
```

每个连接都会拿到一个随机 Webhook 标识和一枚独立的 256 位 Bearer 令牌。

### 安全

- **令牌不落库**：D1 只存令牌的 SHA-256 摘要，校验时常量时间比较。Webhook URL 本身不当作秘密，Bearer 令牌才是凭据。
- **设置入口不轻信 URL 参数**：GitHub 传给 Setup URL 的 `installation_id` 可以被伪造，所以设置流程强制走一次用户 OAuth——用只在单次请求内存活的用户令牌调 `/user/installations` 核对安装 ID，通过后才创建有效期八小时的设置会话。设置页用安装令牌读取可选仓库，不向浏览器暴露任何 GitHub 凭据。
- **GitHub Webhook 验签**：`/github/webhook` 对原始请求体做 `X-Hub-Signature-256` HMAC 校验。收到 `installation.deleted` 或仓库移除事件时删除对应连接，部署状态随外键级联清理。
- **凭据不持久化**：GitHub 安装令牌和用户访问令牌只存在于单次请求；日志不记录请求正文、Authorization 头、OAuth code 和令牌。
- Worker 需要的加密 Secret：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GITHUB_APP_PRIVATE_KEY`（PKCS#8 PEM）、`GITHUB_WEBHOOK_SECRET`、`OAUTH_STATE_SECRET`。

漏洞请按 [SECURITY.md](SECURITY.md) 私下报告。

### 幂等与并发

- 主键 `(connection_id, edgeone_deployment_id)` 保证同一次 EdgeOne 部署在多次重试中始终对应同一个 GitHub SHA。
- 原子 D1 claim 串行化同一部署的并发事件；失败会释放 claim，十秒租约让 EdgeOne 在请求被中途取消后仍能重试。
- 重复事件如果与 `last_event_type` 相同，直接返回成功，不再向 GitHub 写第二次。
- Commit Status 使用固定的 `EdgeOne Makers` context，GitHub 只展示该提交的最新状态；GitHub Deployment ID 会持久化，后续事件更新同一条记录。

## 当前限制

- **一个 EdgeOne 账号同时只能有一个有效连接。** EdgeOne 目前只为整个 Pages / Makers 账号提供一份出站 Webhook 配置，而不是每个项目一份。给另一个项目建连接，就得替换账号级的 Endpoint 和令牌。不同腾讯云账号互不影响。要让同一账号下多个项目同时接入，需要增加共享的账号级入口，再按事件内容路由到各自的连接。
- **Webhook 载荷里没有提交 SHA。** EdgeOne 目前只给出 `repoBranch`。服务在收到某次部署的首个事件时通过 GitHub 解析该分支的 HEAD，后续事件沿用这个 SHA。如果在 push 和首个 Webhook 之间分支又前进了，解析到的提交理论上可能不是实际构建的那一次。若 EdgeOne 之后提供了 SHA，应优先采用，同时保留解析分支 HEAD 的降级路径。

## 本地开发

```bash
cp .dev.vars.example .dev.vars
pnpm install
pnpm db:local
pnpm dev
```

提交前跑完整校验：

```bash
pnpm test
pnpm typecheck
pnpm deploy:dry
```

## 参考资料

- [GitHub：About the setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)
- [GitHub：Using webhooks with a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps)
- [Cloudflare：Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [腾讯云：EdgeOne Pages Webhook](https://cloud.tencent.com/document/product/1552/127680)

## 许可证

[MIT](LICENSE)
