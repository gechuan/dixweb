import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const textExtensions = new Set(['.astro', '.css', '.html', '.js', '.json', '.mjs', '.md', '.svg', '.txt', '.ts', '.xml', '.yml', '.yaml']);
const roots = ['src', 'public'];
const singleFiles = ['.pages.yml', 'README.md'];
const linkOnlyFiles = new Set(['rss.json', 'trends.json']);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const current = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(current) : [current];
  }));
  return files.flat();
}

function isText(file) {
  return textExtensions.has(path.extname(file).toLowerCase());
}

function collectLinks(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectLinks).join('\n');
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => ['link', 'href', 'url'].includes(key))
      .map(([, item]) => collectLinks(item))
      .join('\n');
  }
  return '';
}

async function scanFile(file, blocklist) {
  if (!isText(file)) return [];
  const relative = path.relative(root, file);
  const content = await readFile(file, 'utf8');
  const searchable = linkOnlyFiles.has(path.basename(file)) ? collectLinks(JSON.parse(content)) : content;
  const lower = searchable.toLowerCase();
  const hits = [];
  blocklist.forEach((term) => {
    let index = lower.indexOf(term.toLowerCase());
    while (index !== -1) {
      const before = searchable.slice(0, index);
      const line = before.length ? before.split('\n').length : 1;
      hits.push({ file: relative, line, term });
      index = lower.indexOf(term.toLowerCase(), index + term.length);
    }
  });
  return hits;
}

const blocklist = (await readFile(path.join(root, 'scripts/blocklist.txt'), 'utf8'))
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const directories = await Promise.all(roots.map(async (item) => {
  const directory = path.join(root, item);
  return readdir(directory, { withFileTypes: true }).then(() => walk(directory)).catch(() => []);
}));
const files = [...new Set([
  ...directories.flat(),
  ...singleFiles.map((file) => path.join(root, file)),
])];

const hits = (await Promise.all(files.map((file) => scanFile(file, blocklist).catch(() => [])))).flat();
if (hits.length) {
  console.error('Content blocklist check failed:');
  hits.forEach((hit) => console.error(`  ${hit.file}:${hit.line} — ${hit.term}`));
  process.exit(1);
}
console.log(`Content blocklist check passed (${files.length} files).`);
