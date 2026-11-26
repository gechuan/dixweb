# Deep Into X

Chuan 的个人网站：播客《翻书吧》、每日 AI 资讯、探索和个人项目。

## 技术栈

- [Astro](https://astro.build/) 静态站点
- `src/data/*.json` 作为内容数据，配合 [Pages CMS](https://pagescms.org) 编辑
- Cloudflare Workers Static Assets 部署
- Cloudflare `_redirects` 处理旧路由

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

`prebuild` 会依次执行：

1. 抓取每日探索数据；
2. 执行 `scripts/check-content.mjs`，拦截旧站链接和关键词；
3. 生成站点实际使用的中文字体子集和 Newsreader 字体文件。

`src/data/rss.json` 与 `src/data/trends.json` 是第三方新闻与趋势数据。内容检查脚本只检查这两个文件里的链接字段，避免第三方标题或摘要中的普通词误伤构建。

## 内容维护

- 站点、首页、播客、项目、关于页内容在 `.pages.yml` 中配置，可通过 Pages CMS 编辑。
- 播客只保留《翻书吧》和小宇宙链接。
- 首页目录与首屏数据在构建时从 `rss.json`、`trends.json`、`podcast.json` 自动生成。
- 黑名单维护在 `scripts/blocklist.txt`，命中会阻断构建。

## 运维排查

- [GitHub Actions 失败排查与注意点](docs/github-actions-failures.md)

## 路由

| 路由 | 说明 |
| --- | --- |
| `/` | 首页 |
| `/podcast` | 《翻书吧》 |
| `/rss` | 每日资讯 |
| `/trends` | 探索 |
| `/about` | 关于 |
| `/blog` | 跳转到 `https://blog.deepintox.com` |
| `/projects` | 跳转到首页项目区块 |
| `/notes`、`/notes/*` | 跳转到首页 |
