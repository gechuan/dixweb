# Deep Into X 网站

以 [Astro](https://astro.build/) 构建的个人网站：内容数据化、可云编辑、部署到 Cloudflare Workers Static Assets，并由 GitHub Actions 每日自动更新「资讯」与「探索」。

## 技术栈

- **Astro**：静态构建，零默认客户端 JS，交互脚本按需加载
- **Pages CMS**：通过仓库里的 `.pages.yml` 在浏览器和手机上编辑内容
- **Cloudflare Workers Static Assets**：静态托管与自定义域名
- **GitHub Actions**：每日抓取、构建、提交数据快照并部署
- **Umami**（自托管）：隐私友好的访问统计，通过 `src/data/site.json` 配置

## 本地开发

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # 产物在 dist/
npm run preview
npm run deploy      # 构建并部署当前内容
./scripts/update-content.sh  # 生成昨日资讯并刷新趋势
```

## 云端每日自动更新

GitHub Actions 会在每天 08:30（Asia/Shanghai）执行 `scripts/update-content.sh`，
提交新的数据并部署到 Cloudflare；本机不需要保持运行。部署、secrets、验证与回滚见
[DEPLOYMENT.md](./DEPLOYMENT.md)。

## 内容编辑

所有内容都是 `src/data/*.json` 数据文件，页面只负责渲染：

| 文件 | 内容 |
| --- | --- |
| `site.json` | 站点设置、导航、社交链接、Umami 配置 |
| `home.json` | 首屏、本期目录、播客摘要、今天做了啥 |
| `notes.json` | 随想列表 |
| `podcast.json` | 播客节目、单集、中文精读站 |
| `projects.json` | 项目分组与首页精选 |
| `rss.json` | 每日 AI 资讯数据 |
| `trends.json` | 探索趋势数据 |
| `about.json` | 「关于」页 |

### 用 Pages CMS 云编辑

1. 把仓库推到 GitHub。
2. 打开 [pagescms.org](https://pagescms.org)，用 GitHub 登录并选择这个仓库。
3. CMS 会读取根目录的 `.pages.yml`，自动生成「随想」「项目」等编辑界面，手机上也能改。
4. 保存即提交到仓库；推送后手动触发 Daily content update，或按 [DEPLOYMENT.md](./DEPLOYMENT.md) 部署。

## 部署到 Cloudflare

当前生产方案是 Cloudflare Workers Static Assets，Worker 名称为 `dixweb`。完整部署说明见
[DEPLOYMENT.md](./DEPLOYMENT.md)。

## 接入自托管 Umami

1. 自行部署 Umami（官方支持 Docker / Vercel + Postgres，也可跑在 Cloudflare 之外的 VPS）。
2. 在 Umami 后台添加网站，拿到 Website ID。
3. 修改 `src/data/site.json`：

```json
"umami": {
  "src": "https://umami.example.com/script.js",
  "websiteId": "你的-website-id"
}
```

留空则不加载任何统计脚本。站内按钮已按原站方式埋了 `data-umami-event` 事件（播放、轮播、主题切换等）。

## 上线前替换清单

- `src/data/site.json` 里的 `siteUrl`（影响 sitemap、RSS 和随想复制链接）
- `public/assets/avatar.png`：换成你的头像
- `public/assets/qr-follow.png` / `qr-reward.png`：换成你的公众号二维码和打赏二维码
- 各数据文件里的示例内容换成自己的

## 目录结构

```
├── .github/workflows/ # 每日内容更新与部署
├── .pages.yml          # Pages CMS 配置
├── astro.config.mjs
├── public/assets/      # 头像、二维码等静态资源
├── rss-pipeline/       # 资讯抓取与 DeepSeek 处理脚本
├── scripts/            # 构建前抓取与内容更新脚本
└── src/
    ├── data/           # 全部内容数据（JSON）
    ├── layouts/        # 共享布局（页头、导航、页脚、弹窗）
    ├── pages/          # 首页、随想、项目、播客、探索、资讯、关于、404、RSS
    ├── scripts/site.ts # 主题切换、播放器、轮播、筛选等交互
    └── styles/         # 设计系统样式
```
