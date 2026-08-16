<div align="right"><strong>中文</strong> · <a href="operator-setup.en.md">English</a></div>

# 自托管部署指南

这篇文档介绍如何创建一个公开 GitHub App，并把后端部署到自己的 Cloudflare Workers 账号。建议先用测试 App 验证完整流程；GitHub 不支持把已有的私有 App 直接改成公开 App。

## 一、创建 GitHub App

进入 **GitHub Settings → Developer settings → GitHub Apps → New GitHub App**，填写：

| GitHub 设置 | 填写内容 |
| --- | --- |
| GitHub App name | 一个全局唯一的公开名称 |
| Homepage URL | 项目主页或文档地址 |
| Callback URL | \`https://你的域名/auth/github/callback\` |
| Setup URL | \`https://你的域名/setup\` |
| Redirect on update | 开启 |
| Request user authorization during installation | 关闭 |
| Webhook URL | \`https://你的域名/github/webhook\` |
| Webhook secret | 一枚新生成的随机密钥 |
| Where can this GitHub App be installed? | Any account |

配置 Repository permissions：

- **Commit statuses：Read and write**
- **Contents：Read-only**
- **Deployments：Read and write**
- **Metadata：Read-only**（GitHub 强制要求）

安装、卸载和安装仓库变更等生命周期事件由 GitHub 自动发送，不需要在事件列表里额外勾选。

创建 App 后：

1. 记录 **Client ID**；
2. 生成并记录 **Client Secret**；
3. 生成一枚 **Private key**。

GitHub 下载的 RSA 私钥通常是 PKCS#1 格式，而 Worker Web Crypto 使用 PKCS#8。请在本机转换：

\`\`\`bash
openssl pkcs8 -topk8 -nocrypt \
  -in downloaded-key.pem \
  -out github-app-pkcs8.pem
\`\`\`

不要把任何一份私钥提交进 Git。

## 二、创建 Cloudflare 资源

安装依赖并登录 Wrangler：

\`\`\`bash
pnpm install
pnpm wrangler login
\`\`\`

创建 D1 数据库，并让 Wrangler 更新现有的 \`DB\` binding：

\`\`\`bash
pnpm wrangler d1 create edgeone-github-app --binding DB --update-config
\`\`\`

确认 \`wrangler.jsonc\` 中现有的 D1 配置已经出现 \`database_id\`。如果当前 Wrangler 没有自动写入，就把命令返回的数据库 ID 手动填入。

然后修改 \`wrangler.jsonc\`：

- \`PUBLIC_BASE_URL\`：Worker 的公开 HTTPS 根地址，不带末尾斜杠；
- \`GITHUB_APP_SLUG\`：GitHub App 地址中的 slug。

例如 GitHub App 地址是：

\`\`\`text
https://github.com/apps/edgeone-deploy-checker
\`\`\`

那么 slug 就是：

\`\`\`text
edgeone-deploy-checker
\`\`\`

应用远端数据库迁移：

\`\`\`bash
pnpm db:remote
\`\`\`

## 三、写入 Worker Secrets

使用密码学安全的随机生成器分别生成 OAuth state 密钥和 GitHub Webhook 密钥，例如：

\`\`\`bash
openssl rand -base64 32
\`\`\`

逐项写入 Cloudflare：

\`\`\`bash
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET
pnpm wrangler secret put GITHUB_APP_PRIVATE_KEY
pnpm wrangler secret put GITHUB_WEBHOOK_SECRET
pnpm wrangler secret put OAUTH_STATE_SECRET
\`\`\`

\`GITHUB_APP_PRIVATE_KEY\` 必须粘贴完整的 PKCS#8 PEM，包括：

\`\`\`text
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
\`\`\`

其中 \`GITHUB_WEBHOOK_SECRET\` 必须与 GitHub App 设置页的 **Webhook secret** 完全一致。

## 四、校验并部署

\`\`\`bash
pnpm test
pnpm typecheck
pnpm deploy:dry
pnpm deploy
\`\`\`

如需使用自定义域名：

1. 在 Cloudflare 为 Worker 添加域名；
2. 把 \`PUBLIC_BASE_URL\` 改成该域名；
3. 重新部署；
4. 确认 GitHub App 的 Callback URL、Setup URL 和 Webhook URL 全部使用同一个正式域名。

部署后访问：

\`\`\`text
https://你的域名/health
\`\`\`

正常响应应为：

\`\`\`json
{"ok":true,"service":"edgeone-github-app"}
\`\`\`

再把 GitHub App 安装到一个测试仓库。安装完成后，GitHub 应跳转到 Worker 的设置页。

## 五、连接 EdgeOne 项目

在设置页：

1. 选择 GitHub 仓库；
2. 输入完整的 EdgeOne 项目 ID；
3. 输入 EdgeOne 实际部署的分支；
4. 设置 GitHub Deployment 环境名称，建议使用 \`EdgeOne Production\`；
5. 保持 Commit Status 与 GitHub Deployments 开启；
6. 创建连接。

创建成功后，页面会为 Webhook URL 和 Secret token 分别提供复制按钮。原始令牌只显示一次。

进入腾讯云 **Makers → 设置 → Webhook**：

1. 选择对应项目；
2. 把 URL 粘贴到 **Endpoint**；
3. 把原始令牌粘贴到 **Secret token**；
4. 订阅 \`deployment.created\`、\`deployment.succeeded\` 和 \`deployment.failed\`；
5. 保存。

EdgeOne 实际发送的认证头为：

\`\`\`text
Authorization: Bearer 生成的令牌
\`\`\`

腾讯云的 Secret token 字段只填令牌本身，不需要手动添加 \`Bearer\`。

EdgeOne 会重试非 2xx 响应，因此在部署事件仍在投递时，不要删除连接或轮换令牌。

## 六、端到端验证

在 EdgeOne 手动触发目标分支的一次部署，然后检查：

- GitHub 提交出现 \`EdgeOne Makers\`，状态从 pending 变成 success 或 failure；
- 该状态的 **Details** 直接打开本次 EdgeOne 部署；
- GitHub 仓库的 Deployments 页面出现指定环境；
- Worker 日志中没有 GitHub API 或鉴权错误。

## 七、轮换与删除

- 轮换 Bearer 令牌：删除并重新创建连接，随后立刻更新 EdgeOne Webhook。
- 移除单个仓库：在 GitHub App 安装设置中取消该仓库权限，服务会通过签名 Webhook 清理连接。
- 删除整个租户：卸载 GitHub App，服务会删除该安装及其关联状态。

EdgeOne 当前只为整个 Makers 账号提供一份出站 Webhook 配置。因此，本版本在同一 EdgeOne 账号内只支持一个有效连接；改接其他项目时，需要替换账号级 Endpoint 和令牌。

## 参考资料

- [GitHub：About the setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)
- [GitHub：Using webhooks with a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps)
- [Cloudflare：Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [腾讯云：EdgeOne Pages Webhook](https://cloud.tencent.com/document/product/1552/127680)
