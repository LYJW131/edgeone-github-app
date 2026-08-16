<div align="right"><strong>中文</strong> · <a href="architecture.en.md">English</a></div>

# 架构与安全模型

## 多租户边界

系统以“连接”作为最小配置与隔离单元：

\`\`\`text
GitHub App 安装 + 仓库 + EdgeOne 项目 + 分支 + GitHub 环境
\`\`\`

每个连接都会获得一个随机 Webhook 标识和一枚独立的 256 位 Bearer 令牌。Webhook URL 本身不作为秘密；Bearer 令牌才是凭据。系统只在 D1 中保存令牌的 SHA-256 摘要，不保存原始令牌。

服务不会仅凭设置 URL 中的 \`installation_id\` 判断权限。这个查询参数可以被伪造，因此设置流程还会要求用户完成 GitHub OAuth 授权，通过 GitHub 的用户安装接口验证该用户确实能访问目标安装，然后才创建设置会话。

## 请求流程

### 安装 App 与进入设置页

1. GitHub 安装完成后，把用户重定向到 \`/setup?installation_id=...\`。
2. Worker 生成绑定安装 ID 的签名 OAuth state，并设置一枚 HttpOnly nonce Cookie。
3. GitHub 在用户授权后回调 \`/auth/github/callback\`。
4. Worker 用回调 code 换取仅供当前请求使用的用户令牌，再通过 \`/user/installations\` 验证目标安装 ID。
5. Worker 生成随机设置会话，只把会话摘要存入 D1，并通过 HttpOnly Cookie 保存原始会话令牌；会话有效期为八小时。
6. 设置页使用 GitHub App 安装令牌读取可选仓库，不会把任何 GitHub 凭据暴露给浏览器。

### EdgeOne 部署事件

1. EdgeOne 向 \`/edgeone/:hookId\` 发送部署 Webhook，并携带 \`Authorization: Bearer ...\`。
2. Worker 限制请求体大小、解析事件、哈希令牌，并以常量时间比较凭据。
3. Worker 校验项目与分支；首次事件到达时，通过 GitHub 解析该分支的当前 HEAD。
4. Worker 发布带有 EdgeOne 直达链接的 GitHub Commit Status，并创建或更新 GitHub Deployment 状态。
5. D1 保存本次部署选定的 SHA 和 GitHub 远端对象 ID。同一事件重复投递时不会重复写入。

### GitHub App Webhook

GitHub 向 \`/github/webhook\` 发送 App 生命周期事件。Worker 使用 \`X-Hub-Signature-256\` 对原始请求体进行 HMAC 校验：

- 收到 \`installation.deleted\` 时删除整个安装的租户配置；
- 安装中移除仓库时删除对应连接；
- 关联的部署状态通过数据库外键级联删除。

## 凭据与敏感数据

Worker 需要以下加密 Secret：

- \`GITHUB_CLIENT_ID\`
- \`GITHUB_CLIENT_SECRET\`
- \`GITHUB_APP_PRIVATE_KEY\`（PKCS#8 PEM）
- \`GITHUB_WEBHOOK_SECRET\`
- \`OAUTH_STATE_SECRET\`

GitHub 安装令牌和用户访问令牌只存在于单次请求中，不会持久化。日志不会记录请求正文、Authorization 头、OAuth code 或令牌。

## 幂等与并发

- D1 主键 \`(connection_id, edgeone_deployment_id)\` 保证同一 EdgeOne 部署在重试期间始终使用同一个 GitHub SHA。
- 原子 D1 claim 串行化同一部署的并发事件。失败会释放 claim；十秒租约允许 EdgeOne 在请求中途取消后继续重试。
- 如果重复事件与 \`last_event_type\` 相同，Worker 会直接返回成功，不再向 GitHub 写入第二次。
- Commit Status 使用稳定的 \`EdgeOne Makers\` context；GitHub 展示该提交的最新状态，并将 **Details** 指向对应 EdgeOne 部署页。
- GitHub Deployment ID 会持久化，后续成功或失败事件更新同一部署记录。

## 已知的上游限制

EdgeOne Makers 当前记录的 Webhook 载荷包含 \`repoBranch\`，但不包含提交 SHA。如果在 Git push 与 EdgeOne 首个 Webhook 之间分支再次前进，服务解析出的 HEAD 理论上可能不是实际构建的提交。若 EdgeOne 将来提供 SHA，应优先使用该值，同时保留查询分支 HEAD 的降级路径。

EdgeOne Makers 目前还只为整个账号提供一份出站 Webhook 配置，而不是每个项目一份。由于本版本按连接签发独立凭据，同一个 EdgeOne 账号同时只能有一个有效连接。若要让同一腾讯云账号下的多个项目同时接入，需要增加共享账号级入口，再根据事件内容路由到项目连接。
