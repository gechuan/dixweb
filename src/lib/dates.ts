export const timeZone = 'Asia/Shanghai';

export function shanghaiNow() {
  return new Date();
}

export function longDate(date = shanghaiNow()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'long',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}年${get('month')}月${get('day')}日${get('weekday')}`;
}

export function isoDate(date = shanghaiNow()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function shortDate(value: string) {
  const parsed = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
  }).format(parsed).replace('/', '.');
}

export function isoWeek(date = shanghaiNow()) {
  const [year, month, day] = isoDate(date).split('-').map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  const weekday = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - weekday);
  const start = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  return Math.ceil(((current.getTime() - start.getTime()) / 86400000 + 1) / 7);
}

export function parseFlexibleDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return new Date(`${value.slice(0, 10)}T00:00:00+08:00`);
  }
  const chinese = value.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (chinese) return new Date(Number(chinese[1]), Number(chinese[2]) - 1, Number(chinese[3]));
  const short = value.match(/(\d{1,2})月(\d{1,2})日/);
  if (short) return new Date(shanghaiNow().getFullYear(), Number(short[1]) - 1, Number(short[2]));
  return null;
}
