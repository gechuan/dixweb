# qmwebsite

以 [Astro](https://astro.build/) 复刻的个人网站模板：内容数据化、可云编辑、部署到 Cloudflare、带自托管统计。

## 技术栈

- **Astro**：静态构建，零默认客户端 JS，交互脚本按需加载
- **Pages CMS**：通过仓库里的 `.pages.yml` 在浏览器和手机上编辑内容
- **Cloudflare Pages**：静态托管 + 自动构建，DNS 与 Workers 也在 Cloudflare
- **Umami**（自托管）：隐私友好的访问统计，通过 `src/data/site.json` 配置

## 本地开发

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # 产物在 dist/
npm run preview
```

## 内容编辑

所有内容都是 `src/data/*.json` 数据文件，页面只负责渲染：

| 文件 | 内容 |
| --- | --- |
| `site.json` | 站点设置、导航、社交链接、Umami 配置 |
| `home.json` | 首屏、本期目录、播客摘要、今天做了啥 |
| `notes.json` | 随想列表 |
| `podcast.json` | 播客节目、单集、中文精读站 |
| `projects.json` | 项目分组与首页精选 |
| `uses.json` | 工具箱 |
| `now.json` / `about.json` | 「现在」页与「关于」页 |

### 用 Pages CMS 云编辑

1. 把仓库推到 GitHub。
2. 打开 [pagescms.org](https://pagescms.org)，用 GitHub 登录并选择这个仓库。
3. CMS 会读取根目录的 `.pages.yml`，自动生成「随想」「项目」等编辑界面，手机上也能改。
4. 保存即提交到仓库；如果接了 Cloudflare Pages 的 Git 集成，推送后自动重新构建上线。

## 部署到 Cloudflare

### Workers（静态托管，推荐）

1. Cloudflare 控制台 → Workers & Pages → Create → Connect to Git，选择本仓库。
2. 保持默认即可：构建命令 `npm run build`，部署命令 `npx wrangler deploy`（根目录的 `wrangler.jsonc` 已配置好静态资源目录 `dist` 和 404 处理）。
3. 首次部署得到 `dixweb.<你的子域>.workers.dev` 域名。若构建报 Node 版本问题，在项目 Settings → Variables 里加 `NODE_VERSION` = `22`。

### Pages（经典静态托管，二选一）

不想用 Workers 流程的话，在 Create 界面切到 Pages 标签页连同一个仓库，构建命令 `npm run build`，输出目录 `dist`。

### 自定义域名（DNS）

1. 域名的 DNS 托管在 Cloudflare（或把 NS 迁过去）。
2. Pages 项目 → Custom domains → 添加域名，例如 `www.example.com`。
3. 按提示加一条 CNAME 记录指向 `your-project.pages.dev`，开启代理（橙色云）即自动获得 HTTPS。

### Workers（可选）

静态站本身不需要 Worker。后续如果要加 API（例如表单、随想发布接口），在 `wrangler.toml` 里加 Worker 并绑定路由即可，Pages 与 Worker 同域路由不冲突。

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
├── .pages.yml          # Pages CMS 配置
├── astro.config.mjs
├── public/assets/      # 头像、二维码等静态资源
└── src/
    ├── data/           # 全部内容数据（JSON）
    ├── layouts/        # 共享布局（页头、导航、页脚、弹窗）
    ├── pages/          # 首页、随想、项目、播客、现在、工具箱、关于、404、RSS
    ├── scripts/site.ts # 主题切换、播放器、轮播、筛选等交互
    └── styles/         # 设计系统样式
```
