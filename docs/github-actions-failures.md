# GitHub Actions 失败排查与注意点

本文记录 `Daily content update` workflow 的几类真实故障、根因、修复方式和后续维护注意事项。目标是以后遇到类似失败时，能快速判断是偶发问题还是确定性代码/数据结构问题，并避免重复排查。

## 适用范围

- Workflow：`.github/workflows/daily-update.yml`
- 仓库：`gechuan/dixweb`
- 主要流程：
  1. 拉取 RSS 数据
  2. 调用 DeepSeek 处理新闻
  3. 更新 `src/data/rss.json` 和 `src/data/trends.json`
  4. 运行 `npm run build`
  5. 如数据有变化，提交并推送
  6. 运行 `wrangler deploy`

## 快速判断原则

先看失败步骤和错误类型：

| 现象 | 常见原因 | 处理思路 |
| --- | --- | --- |
| `Run ./scripts/update-content.sh` 在 Python 处理阶段失败 | RSS 网络问题或 DeepSeek 输出格式偶发异常 | 查看 traceback；偶发问题可重跑；结构性问题需修代码 |
| Astro 构建阶段报 `TypeError: Cannot read properties of undefined ...` | CMS 生成的 JSON 缺少代码假设存在的字段 | 对比失败 commit 的数据文件，给代码加默认值或可选访问 |
| `Commit refreshed data` 或 `wrangler deploy` 失败 | Git 推送冲突、权限或 Cloudflare token/配置问题 | 单独查看对应步骤日志 |
| 日志中有 RSS `403`、`419`、`feed parse failed` | 外部源不可用或被拦截 | 通常是 `[skip]`，不是 workflow 失败原因 |
| 只有 Node.js 20 deprecated warning | GitHub runner 的 action 运行时提示 | 不影响结果，可暂不处理 |

最重要的一条：

> `re-run failed jobs` 会继续使用原来那次 run 的 commit。确定性错误不会因为重跑而修复；必须提交修复并重新触发新的 workflow run。

## 历史故障记录

### 2026-11-24：DeepSeek 话题聚类输出偶发异常

- Run：<https://github.com/gechuan/dixweb/actions/runs/45373010535>
- 失败位置：`rss-pipeline/pipeline.py`
- 错误：

```text
TypeError: int() argument must be a string, a bytes-like object or a real number, not 'dict'
```

#### 根因

DeepSeek 返回的话题 `items` 应该是数字序号列表，例如：

```json
"items": [1, 2, 3]
```

但当时某次返回了对象：

```json
"items": [{"index": 1}]
```

原代码直接执行：

```python
index = int(value) - 1
```

于是崩溃。

#### 特点

- 这是模型输出格式偶发问题。
- 手动 re-run 后，DeepSeek 生成了不同输出，格式恰好正确，所以成功。
- RSS 源的大量 `403`、`419`、`feed parse failed` 日志都是 `[skip]`，不是失败原因。

#### 修复

在 `rss-pipeline/pipeline.py` 中校验 DeepSeek 输出：

- `topics` 必须是 list；
- 每个 topic 必须是 dict；
- `items` 必须是 list；
- 单个序号转换失败时跳过，不让整个 job 崩溃；
- `title`、`summary` 缺失或为空时跳过该 topic。

相关提交：

- <https://github.com/gechuan/dixweb/commit/025df68149a8b9b30516aea7ba6a02104a2192b0>

### 2026-11-25：Pages CMS 删除空的 `umami` 配置

- Run：<https://github.com/gechuan/dixweb/actions/runs/45581001931>
- 失败位置：`npm run build`
- 错误：

```text
TypeError: Cannot read properties of undefined (reading 'src')
```

#### 根因

Pages CMS 保存 `src/data/site.json` 时，把空的 `umami` 对象整个删掉了：

```json
"umami": {
  "src": "",
  "websiteId": ""
}
```

而 `src/layouts/Layout.astro` 原来直接访问：

```astro
site.umami.src
```

`site.umami` 不存在，构建 `/404` 页面时崩溃。

#### 特点

- 这是确定性错误。
- re-run 仍使用同一个 commit，所以仍然失败。
- Pages CMS 界面里显示的配置和仓库中实际提交的 JSON 可能不完全一致，构建只看仓库中的 JSON。

#### 修复

改为可选访问：

```astro
site.umami?.src
```

相关提交：

- <https://github.com/gechuan/dixweb/commit/025df68149a8b9b30516aea7ba6a02104a2192b0>

### 2026-11-26：Pages CMS 删除空的 `blog` 和 `now` 配置

- Run：<https://github.com/gechuan/dixweb/actions/runs/45785881332>
- 失败位置：`npm run build`
- 错误：

```text
TypeError: Cannot read properties of undefined (reading 'entries')
```

#### 根因

当天在 Pages CMS 的「首页 → 项目区块 → 标题」中删除过一个标题 item，后来又恢复了。

这个操作本身没有问题。真正的问题是同一次保存会重写整个 `src/data/home.json`，Pages CMS 顺手删除了这些空配置：

```json
"blog": {
  "entries": []
}
```

以及 `now` 中的空字段：

```json
"date": "",
"body": "",
"more": {
  "label": "",
  "href": ""
}
```

而首页代码原来直接访问：

```astro
home.blog.entries
```

`home.blog` 不存在，渲染 `/` 时崩溃。

#### 特点

- 删除/恢复「项目区块标题」不是直接根因。
- 根因是 Pages CMS 对空 list、空对象、空字段的序列化行为。
- 后来恢复标题 item，不会自动恢复被删除的其他空配置。
- 失败 run 使用的是已提交的 JSON，不是 CMS 界面里的临时显示状态。

#### 修复

在 `src/pages/index.astro` 中处理可选结构：

```astro
const blogEntries = (home.blog?.entries ?? []) as LinkEntry[];
```

并为 `now` 建立默认值：

```astro
const nowData = {
  title: home.now?.title ?? '最近在做',
  date: home.now?.date ?? '',
  body: home.now?.body ?? '',
  more: home.now?.more ?? { label: '', href: '' },
};
```

相关提交：

- <https://github.com/gechuan/dixweb/commit/0270175a420673111d81a3787ac0c515e9b6479c>

修复后新的 workflow run：

- <https://github.com/gechuan/dixweb/actions/runs/45813592302>

## Pages CMS 使用注意点

### 1. 保存一个字段可能重写整个 JSON

Pages CMS 保存时，不是只提交你当前编辑的字段，而是重新整理整个数据文件。

因此可能出现：

```text
你编辑项目区块标题
        ↓
保存 home.json
        ↓
除了标题变化
        ↓
其他空的 blog / now 字段也被删除
```

### 2. 空值可能被省略

已观察到的行为包括：

- 空字符串字段可能被删除；
- 空对象可能被删除；
- 空列表外层对象可能被删除；
- JSON 字段顺序可能被调整；
- 文件末尾换行可能变化。

所以代码不能假设 CMS 管理的 JSON 中所有可选结构一定存在。

### 3. 删除列表 item 的风险分级

- 删除列表中的一项，但列表仍有多项：一般没问题。
- 删除到列表为空：Pages CMS 可能进一步删除外层对象。
- 删除后又在 CMS 界面里恢复：只有保存并生成新的 Git commit 后，Actions 才会使用恢复后的数据。
- 恢复某个 item，不代表其他被省略的空配置也会恢复。

### 4. 项目区块标题建议至少保留一项

当前首页代码会读取：

```astro
home.projects.titleLines[0]
home.projects.titleLines[1]
```

如果以后把「项目区块标题」删到完全没有，可能出现新的构建问题，或至少页面标题缺失。

建议：

- 正常修改一项、恢复一项：可以；
- 不要把标题列表清空后保存；
- 如果确实需要允许空标题，应先给代码加默认值。

### 5. 仓库 JSON 是构建依据

判断线上构建行为时，看这些文件：

- `src/data/site.json`
- `src/data/home.json`
- `src/data/podcast.json`
- `src/data/projects.json`
- `src/data/about.json`

不要只看 Pages CMS 界面当前显示的内容。

## 排查流程

### 1. 查看 workflow 状态

```bash
gh run view <run-id> --repo gechuan/dixweb
```

### 2. 只看失败日志

```bash
gh run view <run-id> --repo gechuan/dixweb --log-failed
```

### 3. 确认失败 commit

```bash
gh run view <run-id> \
  --repo gechuan/dixweb \
  --json headSha,event,conclusion,createdAt \
  --jq '.'
```

### 4. 查看该 commit 修改了哪些文件

```bash
gh api repos/gechuan/dixweb/commits/<sha> \
  --jq '{message: .commit.message, files: [.files[] | {filename, status, additions, deletions}]}'
```

本地已有该 commit 时也可以：

```bash
git show --stat <sha>
git show <sha> -- src/data/home.json
```

### 5. 本地复现构建

```bash
npm run build
```

如果本地能复现，优先修本地代码或数据结构。

注意：`npm run build` 会更新 `src/data/trends.json`、字体 manifest，并可能生成新的字体文件。排查后如只想提交源码修复，先确认 `git status`，不要把无关生成文件一起提交。

### 6. 修复后重新触发新的 run

不要只 re-run 旧 run。应提交修复后触发新的 workflow：

```bash
gh workflow run daily-update.yml \
  --repo gechuan/dixweb \
  --ref main
```

或者：

```bash
gh api --method POST \
  repos/gechuan/dixweb/actions/workflows/daily-update.yml/dispatches \
  -f ref=main
```

然后观察：

```bash
gh run watch <new-run-id> \
  --repo gechuan/dixweb \
  --exit-status
```

## 代码维护规则

以后处理 CMS 管理的数据时，遵循以下规则：

### 1. 可选对象使用可选访问

不要写：

```astro
config.field
```

如果 `config` 可能被 Pages CMS 删除，应写：

```astro
config?.field
```

### 2. 列表使用空数组回退

不要写：

```astro
config.items
```

应写：

```astro
config?.items ?? []
```

### 3. 嵌套配置先建立默认值

对于多层结构，先归一化，再让页面读取：

```astro
const section = {
  title: raw?.title ?? '默认标题',
  items: raw?.items ?? [],
};
```

不要在多个模板位置反复写复杂的可选链。

### 4. 对外部模型输出做结构校验

DeepSeek 返回 JSON 后，不应直接假设字段类型正确。先校验：

- 顶层对象；
- list；
- dict；
- 字符串；
- 数字；
- 长度和数量。

局部格式不合格时，跳过局部数据或重试，不要让整个 job 崩溃。

### 5. 构建失败和 RSS 抓取失败分开判断

日志里的：

```text
[skip] ... fetch failed after 3 tries
```

表示该源被跳过，通常不是 job 失败原因。真正失败原因要看最后的 traceback 或 Astro error。

## 常见错误模式

### `Cannot read properties of undefined (reading 'xxx')`

通常表示：

```text
某个对象不存在，但代码直接读取了它的 xxx 字段
```

处理方式：

1. 找到报错对应的页面或组件；
2. 查看失败 commit 中相关 JSON；
3. 确认哪个外层对象被 Pages CMS 删除；
4. 加 `?.` 或默认值；
5. 本地 `npm run build` 验证。

### Python `TypeError: int() argument ... not 'dict'`

通常表示外部模型返回了不符合预期的类型。

处理方式：

- 在解析处校验类型；
- 无法转换的 item 跳过；
- 必要时记录 warning；
- 不要直接崩溃。

### re-run 后仍然失败

优先怀疑确定性错误：

- 数据结构缺失；
- 代码假设错误；
- Git 权限；
- Cloudflare 配置；
- API key 缺失。

此时需要新 commit 和新 workflow run。

## 当前已加固的位置

| 文件 | 加固内容 |
| --- | --- |
| `src/layouts/Layout.astro` | `site.umami` 可选访问 |
| `src/pages/index.astro` | `home.blog` 可选，`entries` 空数组回退 |
| `src/pages/index.astro` | `home.now` 的 `date/body/more` 默认值 |
| `rss-pipeline/pipeline.py` | DeepSeek 话题聚类输出结构校验 |

## 维护建议

1. 修改 Pages CMS 内容后，如果 Actions 失败，先看失败 commit 的 JSON diff。
2. 遇到 `undefined reading 'xxx'`，优先检查 CMS 是否删除了空对象。
3. 不要依赖 re-run 修复确定性错误。
4. 新增 CMS 配置字段时，同步考虑“字段为空或被删除”的情况。
5. 如果继续出现同类问题，可以进一步建立一个数据规范化层，把 `site.json`、`home.json` 等统一转换成带默认值的结构，页面只读取规范化后的对象。
