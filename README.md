<div align="right"><strong>中文</strong> · <a href="README.en.md">English</a></div>

# EdgeOne Deploy Checker

把腾讯云 EdgeOne Pages / 边缘函数 Pages（Makers）的部署状态同步到 GitHub。每次 EdgeOne 构建时，它会在对应提交上显示 \`EdgeOne Makers\` 状态，并在仓库的 Deployments 页面创建独立的部署记录；无需修改站点代码、构建命令或 GitHub Actions。

## 直接使用托管版

- 托管服务：[eo-deploy-checker.lyjw.dev](https://eo-deploy-checker.lyjw.dev)
- GitHub App：[EdgeOne Deploy Checker](https://github.com/apps/edgeone-deploy-checker)

它支持个人账号和组织。安装时选择哪些仓库，App 就只能访问哪些仓库。

### 使用前准备

你需要：

- 一个已经连接到 EdgeOne Pages / Makers 项目的 GitHub 仓库；
- 在该仓库或组织中安装 GitHub App 的权限；
- 修改腾讯云 **EdgeOne Pages / Makers → 设置 → Webhook** 的权限；
- EdgeOne 项目 ID，例如 \`makers-vd4b9ycpaa0n\`。

项目 ID 是腾讯云项目地址中以 \`makers-\` 开头的这一段：

\`\`\`text
https://console.cloud.tencent.com/edgeone/makers/project/makers-vd4b9ycpaa0n/...
                                                        └──── 项目 ID ────┘
\`\`\`

### 第一步：安装 GitHub App

打开[托管设置页](https://eo-deploy-checker.lyjw.dev/setup)，点击 **Install on GitHub**；也可以直接打开 [GitHub App 安装页](https://github.com/apps/edgeone-deploy-checker/installations/new)。

1. 选择 GitHub 仓库所属的个人账号或组织。
2. 建议选择 **Only select repositories**，再勾选需要接收 EdgeOne 部署状态的仓库。
3. 完成安装，并按 GitHub 提示授权设置页。

安装完成后，GitHub 会跳回设置页。如果授权过期或中途退出，重新打开[设置页](https://eo-deploy-checker.lyjw.dev/setup)即可。

### 第二步：创建连接

在设置页填写：

| 字段 | 填写内容 |
| --- | --- |
| Repository | EdgeOne 项目所部署的 GitHub 仓库 |
| EdgeOne project ID | 腾讯云中的完整 \`makers-...\` 项目 ID |
| Deployment branch | EdgeOne 构建的分支，通常是 \`main\` |
| GitHub environment | 建议填写 \`EdgeOne Production\` |
| Create GitHub commit status | 建议开启；在提交上显示 \`EdgeOne Makers\`，Details 直达腾讯云部署页 |
| Create GitHub Deployments | 建议开启；在 GitHub Deployments 页面记录部署 |

如果 Vercel 或其他平台也会向 GitHub 上报部署，请不要沿用默认的 \`Production\`，而应使用 \`EdgeOne Production\`。GitHub 会按环境名称归类，同名会把不同平台的部署混在一起。

点击 **Create connection** 后，页面只会显示一次：

- 专属的 **Webhook URL**；
- 专属的 **Secret token**。

分别点击旁边的 **Copy** 按钮保存。服务只存储令牌摘要，无法再次显示原始令牌。

### 第三步：配置 EdgeOne Webhook

进入腾讯云 **EdgeOne Pages / Makers → 设置 → Webhook**：

1. 选择对应的 EdgeOne 项目。
2. 把设置页生成的 **Webhook URL** 粘贴到 **Endpoint**。
3. 把 **Secret token** 原样粘贴到腾讯云的同名字段。
4. 开启以下三个事件：
   - \`deployment.created\`
   - \`deployment.succeeded\`
   - \`deployment.failed\`
5. 保存。

EdgeOne 会自动把令牌作为 HTTP Bearer 凭据发送。腾讯云字段里只填令牌本身，不要手动添加 \`Bearer\`、引号或其他字符。

### 第四步：验证

在 EdgeOne 上触发一次目标分支的部署。连接正常时，你会看到：

- 对应 GitHub 提交出现 **EdgeOne Makers** 状态，并从等待变为成功或失败；
- 点击该状态的 **Details**，直接打开对应的腾讯云 EdgeOne 部署页；
- GitHub 仓库的 **Deployments → EdgeOne Production** 中出现部署记录。

整个过程不需要增加 GitHub Actions，也不需要针对 EdgeOne 修改站点代码。

## 管理或删除连接

回到[托管设置页](https://eo-deploy-checker.lyjw.dev/setup)，可以查看和删除当前 GitHub App 安装下的连接。

- 如需轮换令牌：删除并重新创建连接，然后立刻更新腾讯云中的 URL 和令牌。
- 如需增删仓库：进入该账号的 GitHub App 安装设置。
- 卸载 GitHub App 后，服务会删除该安装对应的租户配置。

## 当前限制

EdgeOne 目前按整个 Pages / Makers 账号提供一份出站 Webhook 配置，而不是每个项目各一份。因此，这一版本在同一个腾讯云账号内同时只能配置一个有效连接；为另一个项目创建连接时，需要替换账号级 Webhook 的目标地址和令牌。不同腾讯云账号之间不受影响。

EdgeOne Webhook 当前只提供分支名，不提供提交 SHA。收到首次事件时，服务会通过 GitHub 查询该分支的最新提交；同一部署的后续事件会一直使用已记录的 SHA。

## 工作原理

\`\`\`text
EdgeOne 项目 ── Bearer 鉴权 Webhook ──▶ Cloudflare Worker
                                                │
                                                ├── GitHub Commit Status
                                                ├── GitHub Deployment + Status
                                                └── D1 租户与部署状态

GitHub App 安装 ── 用户 OAuth 校验 ─────▶ 设置页面
GitHub App 事件 ── HMAC 鉴权 Webhook ───▶ 安装卸载与仓库移除清理
\`\`\`

服务会：

- 以 \`EdgeOne Makers\` Commit Status 展示构建状态，并让 **Details** 直达对应 EdgeOne 部署；
- 为指定环境创建、更新 GitHub Deployment；
- 验证设置操作确实来自有权访问该 GitHub App 安装的用户；
- 为每个仓库 / 项目连接生成独立、不可猜测的 Webhook URL 和 256 位 Bearer 令牌；
- 校验 GitHub App Webhook 签名，并在 App 卸载或仓库移除时清理租户数据；
- 使用 Cloudflare D1 保存多租户配置和部署状态。

## 自托管与开发

- [架构与安全模型](docs/architecture.md) · [English](docs/architecture.en.md)
- [创建自己的 GitHub App 并部署 Worker](docs/operator-setup.md) · [English](docs/operator-setup.en.md)

本地开发：

\`\`\`bash
cp .dev.vars.example .dev.vars
pnpm install
pnpm db:local
pnpm dev
\`\`\`

运行完整校验：

\`\`\`bash
pnpm test
pnpm typecheck
pnpm deploy:dry
\`\`\`

## 许可证

[MIT](LICENSE)
