# 部署与自动更新说明

## 当前架构

| 环节 | 运行位置 | 说明 |
| --- | --- | --- |
| 代码仓库 | GitHub `gechuan/dixweb` | 唯一代码与内容数据来源 |
| 资讯抓取与处理 | GitHub Actions | 抓取昨日 128 个 RSS 源，用 DeepSeek 生成中文标题、话题和导读 |
| 探索趋势抓取 | GitHub Actions 构建前执行 | 从 `rss.qiaomu.ai` 获取 Hugging Face、Product Hunt、GitHub Trending |
| 网站构建 | GitHub Actions | `npm run build`，产物输出到 `dist/` |
| 托管 | Cloudflare Workers Static Assets | Worker 名称 `dixweb` |
| 线上入口 | Cloudflare | `https://www.deepintox.com`，Worker 地址 `https://dixweb.gechuan.workers.dev` |

这条链路不依赖本机电脑开机；每日任务完全运行在 GitHub Actions 上。
当前生产环境不需要 Cloudflare Pages，也不需要 Cloudflare 的 Git 集成；部署由 GitHub Actions 调用 Wrangler 完成。

## 必需 Secrets

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中配置：

| Secret | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 生成资讯中文标题、话题聚类和编辑导读 |
| `CLOUDFLARE_API_TOKEN` | 通过 Wrangler 部署 `dixweb` Worker |

### DeepSeek token

使用 DeepSeek 开放平台的 API Key。注意：网页/App 会员与 API 额度不是同一概念；如果会员不包含 API 额度，API 调用仍会计费。

### Cloudflare token

在 Cloudflare **My Profile → API Tokens → Create Token → Custom Token** 创建：

- Permissions：`Account Settings : Read`
- Permissions：`Workers Scripts : Edit`
- Account Resources：`Include → Gechuan@icloud.com's Account`

当前 `wrangler.jsonc` 只部署 Worker 与静态资源，没有修改路由，因此不需要 `Workers Routes` 权限。创建后复制只显示一次的 Token Value，并填入 GitHub 的 `CLOUDFLARE_API_TOKEN`。

可用命令确认 secret 名称已配置：

```bash
gh secret list --repo gechuan/dixweb
```

## 每日自动更新

Workflow 文件：`.github/workflows/daily-update.yml`

- Cron：`30 0 * * *`，即北京时间每天 **08:30**
- 抓取窗口：北京时间昨天 00:00–24:00
- 流程：抓取资讯 → DeepSeek 处理 → 刷新趋势 → Astro 构建 → 提交数据快照 → 部署 Cloudflare
- 输出快照：`src/data/rss.json`、`src/data/trends.json`
- 中间文件：`rss-pipeline/news_*.json` 只留在 runner，本地已忽略

GitHub 定时任务可能有几分钟延迟；只要 run 最终成功，不属于异常。

## 手动触发与观察

在 GitHub Actions 页面选择 **Daily content update → Run workflow**，或使用命令：

```bash
gh workflow run 'Daily content update' \
  --repo gechuan/dixweb \
  --ref main
```

查看最近任务：

```bash
gh run list \
  --repo gechuan/dixweb \
  --workflow 'Daily content update' \
  --limit 5
```

跟踪一次任务：

```bash
gh run watch <run-id> \
  --repo gechuan/dixweb \
  --exit-status
```

## 发布普通代码或内容改动

普通改动提交并推送到 `main` 后，可手动触发 **Daily content update** 完成云端构建和部署。也可以在已登录 Cloudflare 的本机执行：

```bash
npm run deploy
```

首次使用本机部署前执行：

```bash
npx wrangler login
```

如果不想走 OAuth，也可以给终端临时设置 `CLOUDFLARE_API_TOKEN` 后运行 `npm run deploy`。

## 本地构建与更新

```bash
npm install
npm run build
npm run preview
```

只刷新资讯与趋势数据，不部署：

```bash
DEEPSEEK_API_KEY='你的-api-key' ./scripts/update-content.sh
```

`npm run build` 会自动执行 `scripts/fetch-trends.mjs`。趋势接口抓取失败时命令会失败，不会静默部署旧快照；脚本内置短重试，偶发网络抖动可重跑。

## 上线验证

每次部署后检查：

```bash
curl -I https://www.deepintox.com
curl -L --max-time 30 -sS https://www.deepintox.com/rss | grep -m 1 'reader-item'
curl -L --max-time 30 -sS https://www.deepintox.com/trends | grep -m 1 '更新于'
```

同时确认 GitHub Actions 全绿，并查看最新提交是否为 `自动更新资讯与探索`。

## 回滚

### 只回滚线上版本

在 Cloudflare 控制台进入 **Workers & Pages → dixweb → Deployments**，选择上一个正常版本并回滚。也可以使用：

```bash
npx wrangler deployments list
npx wrangler rollback <version-id>
```

### 回滚错误数据

如果资讯内容本身有问题，先在 GitHub 回滚或修正对应的数据提交，再重新触发 workflow：

```bash
git revert <commit-id>
git push origin main
gh workflow run 'Daily content update' --repo gechuan/dixweb --ref main
```

只回滚 Cloudflare 不会修改 Git 中的数据快照；下一次自动任务会把旧快照重新部署回来。

## 常见故障

| 现象 | 原因与处理 |
| --- | --- |
| `Invalid access token [code: 9109]` | GitHub secret 里不是有效 Token Value，或误填了 token 名称、Account ID。重新复制 Cloudflare 只显示一次的 token 并更新 secret |
| `No access to the specified service` | Token 没有选中正确 Cloudflare account，或缺少 `Workers Scripts : Edit` |
| DeepSeek 报 `Invalid leading whitespace` | 代码已自动去除 API key 首尾空白；若仍出现，检查是否误填了其他字段 |
| `git push` 在 Actions 内被拒绝 | 运行期间有新提交进入 `main`，重新手动触发 workflow |
| 趋势抓取失败 | 脚本会拒绝发布旧快照；查看上游 API 后重跑 workflow |

## 资源与成本

- Cloudflare：每天一次静态资源部署，访问请求模式不变，额外成本基本为 0。
- GitHub Actions：每次约 1–2 分钟，每月约 30–60 分钟，通常在免费额度内。
- DeepSeek：按 API 用量计费，是唯一需要关注的可变成本。
