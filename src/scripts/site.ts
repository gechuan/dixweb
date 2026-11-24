const $ = <T extends Element = Element>(selector: string, root: ParentNode = document) =>
  root.querySelector(selector) as T | null;
const $$ = <T extends Element = Element>(selector: string, root: ParentNode = document) =>
  [...root.querySelectorAll(selector)] as T[];

function track(event: string, data?: Record<string, unknown>) {
  (window as any).umami?.track?.(event, data);
}

function currentTheme(): 'light' | 'dark' {
  const saved = document.documentElement.dataset.theme;
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initTheme() {
  $$<HTMLButtonElement>('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch {}
      track('theme-toggle', { theme: next });
    });
  });
}

function initNavbar() {
  const mast = $('#mast');
  const navbar = $('#navbar');
  if (mast && navbar) {
    new IntersectionObserver(([entry]) => {
      navbar.classList.toggle('scrolled', !entry.isIntersecting);
    }).observe(mast);
  }

  const nav = $('[data-nav-scroll]');
  if (!nav) return;
  const update = () => {
    const canScroll = nav.scrollWidth > nav.clientWidth;
    const atEnd = nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 4;
    nav.classList.toggle('can-scroll', canScroll);
    nav.classList.toggle('at-end', atEnd);
  };
  nav.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

function updateCurrentDates() {
  const timeZone = 'Asia/Shanghai';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const dateLabel = `${get('year')}年${get('month')}月${get('day')}日${get('weekday')}`;
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).split('-').map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  const weekday = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - weekday);
  const start = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((current.getTime() - start.getTime()) / 86400000 + 1) / 7);

  $$('[data-current-date]').forEach((element) => { element.textContent = dateLabel; });
  $$('[data-current-week]').forEach((element) => { element.textContent = `Week ${week}`; });
}

type ModalKind = 'reward' | 'follow';

function modalContent(kind: ModalKind, qr: { follow: string; reward: string }, social: { github: string; x: string }) {
  if (kind === 'reward') {
    return `
      <div class="modal-content">
        <h2 id="modal-title">打赏支持</h2>
        <p>如果这里的内容对你有帮助，可以请 Chuan 喝杯咖啡。</p>
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
    requestAnimationFrame(() => card.focus());
  };
  const close = () => {
    layer.hidden = true;
    content.innerHTML = '';
    document.body.style.overflow = '';
    opener?.focus();
  };

  $$<HTMLButtonElement>('[data-modal-open]').forEach((button) => {
    button.addEventListener('click', () => open(button.dataset.modalOpen as ModalKind, button));
  });
  $$<HTMLButtonElement>('[data-modal-close]', layer).forEach((button) => button.addEventListener('click', close));
  document.addEventListener('keydown', (event) => {
    if (layer.hidden) return;
    if (event.key === 'Escape') close();
    if (event.key !== 'Tab') return;
    const focusables = $$<HTMLElement>('button, a[href]', layer);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function initFilters() {
  const bar = $('[data-project-filters]');
  if (!bar) return;
  const items = $$<HTMLElement>('[data-project-grid] [data-category]');
  const groups = $$<HTMLElement>('[data-project-group]');
  const countElement = $('[data-project-count]');

  const apply = (key: string) => {
    $$<HTMLButtonElement>('[data-filter]', bar).forEach((button) => {
      const active = button.dataset.filter === key;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
    });
    let visible = 0;
    items.forEach((item) => {
      const show = key === 'all' || item.dataset.category === key;
      item.hidden = !show;
      if (show) visible += 1;
    });
    groups.forEach((group) => {
      group.hidden = !$$<HTMLElement>('[data-category]', group).some((item) => !item.hidden);
    });
    if (countElement) countElement.textContent = String(visible);
  };

  bar.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-filter]');
    if (!button) return;
    apply(button.dataset.filter!);
    const url = new URL(location.href);
    if (button.dataset.filter === 'all') url.searchParams.delete('c');
    else url.searchParams.set('c', button.dataset.filter!);
    history.replaceState(null, '', url);
  });

  const initial = new URL(location.href).searchParams.get('c');
  if (initial && $(`[data-filter="${CSS.escape(initial)}"]`, bar)) apply(initial);
}

export function initSite() {
  const body = document.body;
  initTheme();
  initNavbar();
  updateCurrentDates();
  initModal(
    { follow: body.dataset.qrFollow || '', reward: body.dataset.qrReward || '' },
    { github: body.dataset.github || '', x: body.dataset.x || '' },
  );
  initFilters();
}
