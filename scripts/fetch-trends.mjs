import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUTPUT = path.resolve('src/data/trends.json');
const LIMIT = 10;
const USER_AGENT = 'deepintox-web trends fetcher (+https://www.deepintox.com)';
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
const DEEPSEEK_BATCH_SIZE = 10;

const sourceConfigs = {
  huggingface: {
    title: 'Hugging Face Papers',
    href: 'https://huggingface.co/papers',
    note: '热门研究，看到模型与智能体方法的下一批方向。',
  },
  producthunt: {
    title: 'Product Hunt',
    href: 'https://www.producthunt.com',
    note: '新产品发布，观察用户正在为什么工作流付费。',
  },
  github_trending: {
    title: 'GitHub Trending',
    href: 'https://github.com/trending',
    note: '开源项目热度，看到工程实践与开发工具的新势能。',
  },
};

const fetchers = {
  huggingface: fetchHuggingFacePapers,
  producthunt: fetchProductHuntFeed,
  github_trending: fetchGitHubTrending,
};

const xmlEntities = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(value = '') {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return xmlEntities[entity.toLowerCase()] ?? match;
  });
}

function cleanSummary(text) {
  return decodeEntities(String(text ?? ''))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s*Discussion\s*\|\s*Link\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(text = '', max = 180) {
  const value = cleanSummary(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function formatDate(value) {
  if (!value) return '';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(time));
}

function xmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

function atomAlternateLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/>/gi)];
  const alternate = links.find(([, attributes]) => /\brel=["']alternate["']/i.test(attributes));
  const selected = alternate ?? links[0];
  return selected ? decodeEntities(selected[1].match(/href=["']([^"']+)["']/i)?.[1] ?? '') : '';
}

async function fetchWithRetry(url, headers, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw new Error(`${label}: ${lastError.message}`);
}

async function callDeepSeek(prompt, apiKey) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          temperature: 0.3,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: '你是严谨的中文科技趋势编辑，擅长把英文研究、产品和开源项目内容改写成自然中文。',
            },
            { role: 'user', content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
      }

      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('empty completion');
      }
      return content.trim();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  }
  throw new Error(`DeepSeek: ${lastError.message}`);
}

function parseDeepSeekJson(content) {
  const candidates = [content, content.match(/\{[\s\S]*\}/)?.[0] ?? ''];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('DeepSeek returned invalid JSON');
}

async function rewriteItemsWithDeepSeek(items) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is required to rewrite trend titles and summaries');
  }

  const rewritten = new Map();
  for (let start = 0; start < items.length; start += DEEPSEEK_BATCH_SIZE) {
    const batch = items.slice(start, start + DEEPSEEK_BATCH_SIZE);
    const material = batch.map((item) => ({
      id: item.id,
      source: item.sourceTitle,
      title: item.title,
      summary: item.summary,
    }));

    const prompt = [
      '下面是探索页的源头趋势条目。请把 title 和 summary 改写成中文，输出严格 JSON：',
      '{"items":[{"id":"输入id原样返回","title":"中文标题","summary":"中文导读"}]}。',
      '要求：',
      '1. Hugging Face 和 Product Hunt 的 title 必须改成自然中文标题；专有名词、模型名、产品名可保留英文。',
      '2. GitHub Trending 的 title 保留 owner/repo 原样；summary 改成中文。',
      '3. summary 写 2-3 句中文导读，控制在 100-180 个中文字符，提炼核心事实和值得看的地方。',
      '4. 不要逐句翻译原文。先判断核心问题、方案或产品形态、适用场景和值得看的点，再用中文编辑语言重写。',
      '5. 只使用输入材料中的信息，不要补充外部事实，不要营销话术，不要输出链接。',
      '6. 返回数量、顺序、id 必须与输入完全一致，不要解释。',
      `输入：${JSON.stringify(material)}`,
    ].join('\n');

    const content = await callDeepSeek(prompt, apiKey);
    const parsed = parseDeepSeekJson(content);
    const results = parsed?.items;
    if (!Array.isArray(results) || results.length !== batch.length) {
      throw new Error(`DeepSeek rewrite batch ${start / DEEPSEEK_BATCH_SIZE + 1}: item count mismatch`);
    }

    results.forEach((result, index) => {
      const expected = batch[index];
      if (!result || result.id !== expected.id) {
        throw new Error(`DeepSeek rewrite batch ${start / DEEPSEEK_BATCH_SIZE + 1}: id mismatch`);
      }
      const title = cleanSummary(result.title);
      const summary = cleanSummary(result.summary);
      if (!title || !summary) {
        throw new Error(`DeepSeek rewrite batch ${start / DEEPSEEK_BATCH_SIZE + 1}: empty title or summary`);
      }
      rewritten.set(expected.id, { title, summary });
    });
  }

  return items.map((item) => {
    const rewrite = rewritten.get(item.id);
    if (!rewrite) throw new Error(`DeepSeek rewrite missing item: ${item.id}`);
    return {
      ...item,
      title: rewrite.title,
      summary: compactText(rewrite.summary, 180),
    };
  });
}

async function fetchHuggingFacePapers() {
  const text = await fetchWithRetry(
    'https://huggingface.co/api/daily_papers',
    { Accept: 'application/json' },
    'Hugging Face Papers',
  );

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Hugging Face Papers: invalid JSON');
  }
  if (!Array.isArray(payload) || !payload.length) {
    throw new Error('Hugging Face Papers: no papers returned');
  }

  return payload
    .map((entry) => {
      const paper = entry.paper ?? {};
      const id = String(paper.id ?? '').trim();
      const title = cleanSummary(paper.title ?? entry.title);
      if (!id || !title) return null;

      const published = paper.submittedOnDailyAt ?? paper.publishedAt ?? entry.publishedAt;
      const upvotes = Number(paper.upvotes ?? 0);
      return {
        id: `huggingface:${id}`,
        title,
        summary: compactText(paper.summary ?? entry.summary, 900),
        href: `https://huggingface.co/papers/${id}`,
        meta: id ? `arXiv ${id}${upvotes ? ` · ${upvotes} upvotes` : ''}` : 'Paper',
        date: formatDate(published),
        upvotes,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.upvotes - a.upvotes)
    .slice(0, LIMIT)
    .map(({ upvotes, ...entry }) => entry);
}

async function fetchProductHuntFeed() {
  const xml = await fetchWithRetry(
    'https://www.producthunt.com/feed',
    { Accept: 'application/atom+xml, application/xml, text/xml' },
    'Product Hunt',
  );

  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, block]) => {
    const title = xmlTag(block, 'title');
    const id = xmlTag(block, 'id');
    const href = atomAlternateLink(block);
    const published = xmlTag(block, 'published');
    const author = xmlTag(block, 'name');
    const summary = xmlTag(block, 'content');
    if (!title || !href || !published) return null;

    const numericId = id.match(/Post\/(\d+)/i)?.[1] ?? id;
    return {
      id: `producthunt:${numericId}`,
      title,
      summary: compactText(summary || 'Product Hunt new launch.', 900),
      href,
      meta: author ? `Maker · ${author}` : 'Product Hunt',
      date: formatDate(published),
      publishedAt: Date.parse(published),
    };
  }).filter(Boolean);

  if (!entries.length) throw new Error('Product Hunt: no entries returned');

  return entries
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, LIMIT)
    .map(({ publishedAt, ...entry }) => entry);
}

async function fetchGitHubTrending() {
  const html = await fetchWithRetry(
    'https://github.com/trending',
    { Accept: 'text/html' },
    'GitHub Trending',
  );

  const articles = [...html.matchAll(/<article\b[^>]*\bclass=(["'])[^"']*\bBox-row\b[^"']*\1[^>]*>([\s\S]*?)<\/article>/gi)];

  const repositories = articles.map(([, , article]) => {
    const heading = article.match(/<h2\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!heading) return null;

    const href = new URL(decodeEntities(heading[1]), 'https://github.com/').toString();
    const pathname = new URL(href).pathname.replace(/^\/|\/$/g, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(pathname)) return null;

    const title = cleanSummary(heading[2]).replace(/\s+\/\s+/, '/');
    const description = article.match(/<p\b[^>]*\bclass=(["'])[^"']*\bcol-9\b[^"']*\1[^>]*>([\s\S]*?)<\/p>/i);
    const language = article.match(/<span\b[^>]*itemprop=["']programmingLanguage["'][^>]*>([\s\S]*?)<\/span>/i);
    const stars = article.match(/<a\b[^>]*href=["'][^"']+\/stargazers["'][^>]*>([\s\S]*?)<\/a>/i);

    const languageLabel = language ? cleanSummary(language[1]) : '';
    const starsLabel = stars ? cleanSummary(stars[1]).replace(/[^\d.,]/g, '') : '';
    const meta = [
      starsLabel ? `${starsLabel} stars` : '',
      languageLabel,
    ].filter(Boolean).join(' · ');

    return {
      id: `github:${pathname}`,
      title,
      summary: compactText(description?.[2] || 'GitHub daily trending repository.', 900),
      href,
      meta: meta || 'GitHub',
      date: 'Trending',
    };
  }).filter(Boolean);

  if (!repositories.length) throw new Error('GitHub Trending: no repositories returned');

  return repositories.slice(0, LIMIT);
}

let data;
try {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    throw new Error('DEEPSEEK_API_KEY is required to rewrite trend titles and summaries');
  }

  const sources = await Promise.all(
    Object.entries(sourceConfigs).map(async ([sourceId, config]) => ({
      id: sourceId,
      ...config,
      items: await fetchers[sourceId](),
    })),
  );

  const rawItems = sources.flatMap((source) =>
    source.items.map((item) => ({ ...item, sourceTitle: source.title })),
  );
  const rewrittenItems = await rewriteItemsWithDeepSeek(rawItems);
  const rewrittenById = new Map(rewrittenItems.map((item) => [item.id, item]));

  for (const source of sources) {
    source.items = source.items.map((item) => {
      const { sourceTitle, ...rewritten } = rewrittenById.get(item.id);
      return rewritten;
    });
  }

  data = {
    updatedAt: new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai',
      hour12: false,
    }).format(new Date()),
    sources,
  };
} catch (error) {
  console.error('Trends refresh failed; refusing to deploy a stale snapshot:', error.message);
  process.exitCode = 1;
}

if (data) {
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(data, null, 2)}\n`);
}
