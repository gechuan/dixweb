type Track = {
  title: string;
  artist: string;
  album: string;
  dateLabel: string;
  url: string;
  audioUrl: string;
  apiUrl: string;
  coverUrl: string;
};

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

function parseLrc(text: string): { time?: number; text: string }[] {
  const lines: { time?: number; text: string }[] = [];
  String(text).split(/\r?\n/).forEach((line) => {
    const times = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)].map((m) =>
      Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0),
    );
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!text || /^[.…·\-\s]+$/.test(text) || /^[\(（\[].*[\)）\]]$/.test(text)) return;
    if (times.length) times.forEach((t) => lines.push({ time: t, text }));
    else lines.push({ text });
  });
  return lines.sort((a, b) => (a.time ?? 1e9) - (b.time ?? 1e9));
}

function initMusic() {
  const root = $('[data-music]');
  const dataEl = $('#music-data');
  if (!root || !dataEl) return;
  let tracks: Track[] = [];
  try {
    tracks = JSON.parse(dataEl.textContent || '[]');
  } catch {}
  if (!tracks.length) return;

  const audio = $<HTMLAudioElement>('[data-audio]', root)!;
  const seek = $<HTMLInputElement>('[data-seek]', root)!;
  const elapsed = $('[data-elapsed]', root)!;
  const duration = $('[data-duration]', root)!;
  const line = $('[data-line]', root)!;
  const nextLine = $('[data-next]', root)!;
  const shuffleBtn = $<HTMLButtonElement>('[data-shuffle]', root)!;
  const cover = $<HTMLImageElement>('[data-cover]', root)!;

  let index = 0;
  let shuffle = false;
  let scrubbing = false;
  let lyricLines: { time?: number; text: string }[] = [];
  let lyricAt = -2;
  let history: number[] = [];

  const fmt = (s: number) =>
    Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '--:--';

  function showLyric(i: number) {
    if (i === lyricAt) return;
    lyricAt = i;
    line.textContent = lyricLines[i]?.text || (lyricLines.length ? ' ' : '纯音乐，或歌词还没上传');
    nextLine.textContent = lyricLines[i + 1]?.text || ' ';
  }

  function syncLyric(time: number) {
    if (!lyricLines.length) return showLyric(-1);
    const timed = lyricLines.some((l) => typeof l.time === 'number');
    let i = 0;
    if (timed) {
      lyricLines.forEach((l, j) => {
        if (typeof l.time === 'number' && l.time <= time + 0.15) i = j;
      });
    } else if (audio.duration) {
      i = Math.min(lyricLines.length - 1, Math.floor((time / audio.duration) * lyricLines.length));
    }
    showLyric(i);
  }

  async function loadLyrics(track: Track) {
    lyricLines = [];
    lyricAt = -2;
    line.textContent = ' ';
    nextLine.textContent = ' ';
    try {
      const res = await fetch(track.apiUrl, { cache: 'force-cache' });
      const json = await res.json();
      const t = json.track || json;
      lyricLines = (Array.isArray(t.lyricLines)
        ? t.lyricLines.map((l: any) => ({ text: String(l.text || '').trim(), time: l.time }))
        : parseLrc(t.lyrics || '')
      ).filter((l: any) => l.text && !/^[\(（\[].*[\)）\]]$/.test(l.text) && !/^[.…·\-\s]+$/.test(l.text));
    } catch {}
    if (tracks[index] === track) {
      lyricAt = -2;
      showLyric(0);
    }
  }

  function renderTrack(track: Track) {
    $('[data-title]', root)!.textContent = track.title;
    $('[data-meta]', root)!.textContent = [track.artist, track.album, track.dateLabel].filter(Boolean).join(' · ');
    const link = $<HTMLAnchorElement>('[data-link]', root)!;
    link.href = track.url || 'https://music.qiaomu.ai/';
    cover.classList.add('loading');
    cover.onload = () => cover.classList.remove('loading');
    cover.src = track.coverUrl;
    $$<HTMLButtonElement>('[data-track]', root).forEach((btn) => {
      if (Number(btn.dataset.track) === index) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist || 'Qiaomu',
        album: track.album || 'Qiaomu Music',
        artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: '512x512' }] : [],
      });
    }
  }

  function load(i: number, autoplay: boolean, remember = true) {
    if (remember && audio.src) history.push(index);
    index = (i + tracks.length) % tracks.length;
    const track = tracks[index];
    renderTrack(track);
    audio.src = track.audioUrl;
    seek.value = '0';
    seek.style.setProperty('--p', '0%');
    elapsed.textContent = '0:00';
    duration.textContent = '--:--';
    loadLyrics(track);
    if (autoplay) audio.play().catch(() => {});
  }

  function next() {
    if (shuffle && tracks.length > 1) {
      let pick = index;
      while (pick === index) pick = Math.floor(Math.random() * tracks.length);
      load(pick, true);
    } else {
      load(index + 1, true);
    }
  }

  function prev() {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
    } else if (history.length) {
      load(history.pop()!, true, false);
    } else {
      load(index - 1, true, false);
    }
  }

  $('[data-play]', root)!.addEventListener('click', () => {
    if (!audio.src) load(index, false, false);
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  });
  $('[data-next]', root)!.addEventListener('click', next);
  $('[data-prev]', root)!.addEventListener('click', prev);
  shuffleBtn.addEventListener('click', () => {
    shuffle = !shuffle;
    shuffleBtn.setAttribute('aria-pressed', String(shuffle));
    track('music-shuffle', { on: shuffle });
  });
  $$<HTMLButtonElement>('[data-track]', root).forEach((btn) =>
    btn.addEventListener('click', () => load(Number(btn.dataset.track), true)),
  );
  seek.addEventListener('input', () => {
    scrubbing = true;
    seek.style.setProperty('--p', `${Number(seek.value) / 10}%`);
    if (audio.duration) elapsed.textContent = fmt((Number(seek.value) / 1000) * audio.duration);
  });
  seek.addEventListener('change', () => {
    if (audio.duration) audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
    scrubbing = false;
  });
  audio.addEventListener('loadedmetadata', () => (duration.textContent = fmt(audio.duration)));
  audio.addEventListener('timeupdate', () => {
    if (!scrubbing && audio.duration) {
      const v = (audio.currentTime / audio.duration) * 1000;
      seek.value = String(v);
      seek.style.setProperty('--p', `${v / 10}%`);
      elapsed.textContent = fmt(audio.currentTime);
    }
    syncLyric(audio.currentTime);
  });
  audio.addEventListener('play', () => {
    root.classList.add('playing');
    $('[data-play]', root)!.setAttribute('aria-label', '暂停');
    track('music-play', { track: tracks[index]?.title || '' });
  });
  audio.addEventListener('pause', () => {
    root.classList.remove('playing');
    $('[data-play]', root)!.setAttribute('aria-label', '播放');
  });
  audio.addEventListener('ended', next);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('nexttrack', next);
  }
  new IntersectionObserver(([entry], obs) => {
    if (entry.isIntersecting) {
      obs.disconnect();
      loadLyrics(tracks[0]);
    }
  }, { rootMargin: '300px' }).observe(root);
}

type ModalKind = 'reward' | 'follow';

function modalContent(kind: ModalKind, qr: { follow: string; reward: string }, social: { github: string; x: string }) {
  if (kind === 'reward') {
    return `
      <div class="modal-content">
        <h2 id="modal-title">打赏支持</h2>
        <p>如果这些工具、文章或推荐对你有帮助，可以请乔木喝杯咖啡。</p>
        <img class="qr-image" src="${qr.reward}" width="220" height="220" alt="打赏二维码" />
      </div>`;
  }
  return `
    <div class="modal-content">
      <h2 id="modal-title">关注向阳乔木</h2>
      <p>微信扫码关注公众号「向阳乔木推荐看」</p>
      <img class="qr-image" src="${qr.follow}" width="220" height="220" alt="公众号二维码" />
      <div class="modal-links">
        <a href="${social.github}" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="${social.x}" target="_blank" rel="noopener noreferrer">X @vista8</a>
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

function initFriends() {
  const root = $('[data-friends]');
  if (!root) return;
  const slides = $$<HTMLElement>('[data-slide]', root);
  const tiles = $$<HTMLButtonElement>('[data-go]', root);
  const counter = $('[data-current]', root);
  if (slides.length < 2) return;
  let current = 0;

  function go(i: number) {
    current = (i + slides.length) % slides.length;
    slides.forEach((slide, j) => (slide.hidden = j !== current));
    tiles.forEach((tile, j) => {
      if (j === current) tile.setAttribute('aria-current', 'true');
      else tile.removeAttribute('aria-current');
    });
    if (counter) counter.textContent = String(current + 1).padStart(2, '0');
    track('friend-carousel', { to: current });
  }

  tiles.forEach((tile) => tile.addEventListener('click', () => go(Number(tile.dataset.go))));
  $('[data-prev]', root)!.addEventListener('click', () => go(current - 1));
  $('[data-next]', root)!.addEventListener('click', () => go(current + 1));
  root.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (e.key === 'ArrowRight') go(current + 1);
    if (e.key === 'ArrowLeft') go(current - 1);
  });

  const strip = $('[data-slides]', root)!;
  let startX = 0;
  let startY = 0;
  strip.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  strip.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) go(current + (dx < 0 ? 1 : -1));
  }, { passive: true });
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
  initModal(qr, social);
  initMusic();
  initFriends();
  initFilters();
}
