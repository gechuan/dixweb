import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import subsetFont from 'subset-font';

const serifSourceUrl = 'https://fonts.gstatic.com/s/notoserifsc/v36/H4cyBXePl9DZ0Xe7gG9cyOj7uK2-n-D2rd4FY7RcrCWv.ttf';
const latinFontUrl = 'https://fonts.gstatic.com/s/newsreader/v26/cY9AfjOCX1hbuyalUrK4397yjIJFJpc.woff2';
const cacheDirectory = path.resolve('.cache/fonts');
const outputDirectory = path.resolve('public/fonts');
const commonCharacters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ·.、,:：;；!！?？“”‘’《》〈〉【】（）( )［］[ ]—－-…%％+＋&＆/／@＠#＃*＊';

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const current = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(current) : [current];
  }));
  return files.flat();
}

function collectDisplayText(value, key = '') {
  if (['title', 'titleLines', 'name'].includes(key) && typeof value === 'string') return value;
  if (['title', 'titleLines', 'name'].includes(key) && Array.isArray(value)) return value.join('');
  if (Array.isArray(value)) return value.map((item) => collectDisplayText(item)).join('');
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([childKey, item]) => collectDisplayText(item, childKey)).join('');
  }
  return '';
}

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

await mkdir(cacheDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });

const serifCache = path.join(cacheDirectory, 'noto-serif-sc-600.ttf');
const latinOutput = path.join(outputDirectory, 'newsreader-latin.woff2');
try {
  await readFile(serifCache);
} catch {
  await download(serifSourceUrl, serifCache);
}
try {
  await readFile(latinOutput);
} catch {
  await download(latinFontUrl, latinOutput);
}

const dataFiles = (await walk(path.resolve('src/data'))).filter((file) => file.endsWith('.json'));
const displayText = (await Promise.all(dataFiles.map(async (file) => collectDisplayText(JSON.parse(await readFile(file, 'utf8')))))).join('');
const astroFiles = (await walk(path.resolve('src/pages'))).filter((file) => file.endsWith('.astro'));
const headingText = (await Promise.all(astroFiles.map(async (file) => {
  const source = await readFile(file, 'utf8');
  return [...source.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)]
    .map((match) => match[1].replace(/\{[\s\S]*?\}/g, '').replace(/<[^>]+>/g, ''))
    .join('');
}))).join('');

const characters = new Set(`${displayText}${headingText}${commonCharacters}`);
const text = [...characters].join('');
const source = await readFile(serifCache);
const subset = await subsetFont(source, text, { targetFormat: 'woff2', noHinting: true });
const hash = createHash('sha256').update(subset).digest('hex').slice(0, 10);
const filename = `serif-sc-subset.${hash}.woff2`;
await writeFile(path.join(outputDirectory, filename), subset);
await writeFile(
  path.resolve('src/data/font-manifest.json'),
  `${JSON.stringify({ serifSc: filename }, null, 2)}\n`,
);

const stale = (await readdir(outputDirectory)).filter((file) => file.startsWith('serif-sc-subset.') && file !== filename && file !== 'serif-sc-subset.placeholder.woff2');
await Promise.all(stale.map(async (file) => {
  const fs = await import('node:fs/promises');
  await fs.unlink(path.join(outputDirectory, file));
}));

const size = subset.length;
console.log(`Built ${filename} with ${characters.size} characters (${(size / 1024).toFixed(1)} KB).`);
if (size > 120 * 1024) console.warn('Warning: serif subset exceeds the 120 KB budget.');
