import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://rss.qiaomu.ai/api/entries';
const OUTPUT = path.resolve('src/data/trends.json');
const LIMIT = 10;

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

function cleanSummary(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s*Discussion\s*\|\s*Link\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(text = '', max = 240) {
  const value = cleanSummary(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function arxivId(link = '') {
  return link.match(/arxiv\.org\/(?:abs|pdf|html)\/([^/?#]+)/i)?.[1] ?? '';
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

function normalizeItem(sourceId, entry) {
  const title = sourceId === 'github_trending' ? entry.title : entry.titleZh || entry.title;
  const rewrite = entry.assets?.preview?.type === 'rewrite' ? entry.assets.preview.text : '';
  const summaryZh = compactText(entry.summaryZh, 180);
  const summary = compactText(rewrite || summaryZh || entry.summary, 180);

  if (sourceId === 'huggingface') {
    const id = arxivId(entry.link);
    return {
      id: entry.id,
      title,
      summary,
      href: entry.link,
      meta: id ? `arXiv ${id}` : 'Paper',
      date: formatDate(entry.published),
    };
  }

  if (sourceId === 'producthunt') {
    return {
      id: entry.id,
      title,
      summary,
      href: entry.link,
      meta: entry.author ? `Maker · ${entry.author}` : 'Product Hunt',
      date: formatDate(entry.published),
    };
  }

  return {
    id: entry.id,
    title,
    summary,
    href: entry.link,
    meta: 'Daily Trending',
    date: 'GitHub',
  };
}

async function fetchSource(sourceId) {
  const url = new URL(API);
  url.searchParams.set('source', sourceId);
  url.searchParams.set('limit', String(LIMIT));
  url.searchParams.set('summary', 'full');

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const entries = (payload.entries ?? []).filter((entry) => !entry.deletedAt);
      if (!entries.length) {
        throw new Error('no entries returned');
      }
      return entries.slice(0, LIMIT).map((entry) => normalizeItem(sourceId, entry));
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw new Error(`${sourceId}: ${lastError.message}`);
}

let data;
try {
  const sources = await Promise.all(
    Object.entries(sourceConfigs).map(async ([sourceId, config]) => ({
      id: sourceId,
      ...config,
      items: await fetchSource(sourceId),
    })),
  );

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
