
const $ = <T extends Element = Element>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;
const $$ = <T extends Element = Element>(sel: string, root: ParentNode = document) =>
  [...root.querySelectorAll(sel)] as T[];

function track(event: string, data?: Record<string, unknown>) {
  (window as any).umami?.track?.(event, data);
}

function currentTheme(): 'light' | 'dark' {
  const saved = document.documentElement.dataset.theme;
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initTheme() {
  $$<HTMLButtonElement>('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch {}
      track('theme-toggle', { theme: next });
    });
  });
}

function initNavbar() {
  const mast = $('#mast');
  const navbar = $('#navbar');
  if (!mast || !navbar) return;
  new IntersectionObserver(([entry]) => {
    navbar.classList.toggle('scrolled', !entry.isIntersecting);
  }).observe(mast);
}

function updateCurrentDates() {
  const timeZone = 'Asia/Shanghai';
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'long',
  }).formatToParts(now);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    dateParts.find((part) => part.type === type)?.value ?? '';
  const dateLabel = `${getPart('year')}年${getPart('month')}月${getPart('day')}日${getPart('weekday')}`;

  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now).split('-').map(Number);
  const isoDate = new Date(Date.UTC(year, month - 1, day));
  const dayNum = isoDate.getUTCDay() || 7;
  isoDate.setUTCDate(isoDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(isoDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((isoDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  $$('[data-current-date]').forEach((element) => {
    element.textContent = dateLabel;
  });
  $$('[data-current-week]').forEach((element) => {
    element.textContent = `Week ${week}`;
  });
}

type ModalKind = 'reward' | 'follow';

function modalContent(kind: ModalKind, qr: { follow: string; reward: string }, social: { github: string; x: string }) {
  if (kind === 'reward') {
    return `
      <div class="modal-content">
        <h2 id="modal-title">打赏支持</h2>
        <p>如果这些工具、文章或推荐对你有帮助，可以请Chuan 喝杯咖啡。</p>
        <img class="qr-image" src="${qr.reward}" width="220" height="220" alt="打赏二维码" />
      </div>`;
  }
  return `
    <div class="modal-content">
      <h2 id="modal-title">欢迎关注</h2>
      <p>微信扫码关注公众号「Deep Into X」</p>
      <img class="qr-image" src="${qr.follow}" width="220" height="220" alt="公众号二维码" />
      <div class="modal-links">
        <a href="${social.github}" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="${social.x}" target="_blank" rel="noopener noreferrer">X @gechuan</a>
      </div>
    </div>`;
}

function initModal(qr: { follow: string; reward: string }, social: { github: string; x: string }) {
  const layer = $('[data-modal-layer]');
  const card = $('.modal-card');
  const content = $('[data-modal-content]');
  if (!layer || !card || !content) return;
  let opener: HTMLElement | null = null;

  const open = (kind: ModalKind, from: HTMLElement) => {
    opener = from;
    content.innerHTML = modalContent(kind, qr, social);
    layer.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => (card as HTMLElement).focus());
  };
  const close = () => {
    layer.hidden = true;
    content.innerHTML = '';
    document.body.style.overflow = '';
    opener?.focus?.();
  };

  $$<HTMLButtonElement>('[data-modal-open]').forEach((btn) =>
    btn.addEventListener('click', () => open(btn.dataset.modalOpen as ModalKind, btn)),
  );
  $$<HTMLButtonElement>('[data-modal-close]', layer).forEach((btn) => btn.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (layer.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key !== 'Tab') return;
    const focusables = $$<HTMLElement>('button, a', layer);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

function initFilters() {
  const bar = $('[data-project-filters]');
  if (!bar) return;
  const items = $$<HTMLElement>('[data-project-grid] [data-category]');
  const groups = $$<HTMLElement>('[data-project-group]');
  const countEl = $('[data-project-count]');

  const apply = (key: string) => {
    $$<HTMLButtonElement>('[data-filter]', bar).forEach((btn) =>
      btn.setAttribute('aria-pressed', String(btn.dataset.filter === key)),
    );
    let visible = 0;
    items.forEach((item) => {
      const show = key === 'all' || item.dataset.category === key;
      item.hidden = !show;
      if (show) visible += 1;
    });
    groups.forEach((group) => {
      group.hidden = !$$<HTMLElement>('[data-category]', group).some((item) => !item.hidden);
    });
    if (countEl) countEl.textContent = String(visible);
  };

  bar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-filter]');
    if (!btn) return;
    apply(btn.dataset.filter!);
    const url = new URL(location.href);
    if (btn.dataset.filter === 'all') url.searchParams.delete('c');
    else url.searchParams.set('c', btn.dataset.filter!);
    history.replaceState(null, '', url);
  });

  const initial = new URL(location.href).searchParams.get('c');
  if (initial && $(`[data-filter="${CSS.escape(initial)}"]`, bar)) apply(initial);
}

export function initSite() {
  const body = document.body;
  const qr = {
    follow: body.dataset.qrFollow || '',
    reward: body.dataset.qrReward || '',
  };
  const social = {
    github: body.dataset.github || '',
    x: body.dataset.x || '',
  };
  initTheme();
  initNavbar();
  updateCurrentDates();
  initModal(qr, social);
  initFilters();
}
