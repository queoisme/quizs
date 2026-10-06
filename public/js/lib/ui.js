'use strict';
/* Tiện ích DOM, thanh câu hỏi, bảng xếp hạng và vòng lặp khung hình */
const $ = (sel) => document.querySelector(sel);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const loginUrl = () => `/login?next=${encodeURIComponent(location.pathname + location.search)}`;

async function logout() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
}

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
}

class QuestionBar {
  constructor() {
    this.count = $('#qcount');
    this.text = $('#qtext');
    this.timer = $('#qtimer');
    this.fill = $('#timefill');
    this.deadline = 0;
    this.duration = 1;
    this.frozen = null; // số ms còn lại lúc tạm dừng
  }

  message(text) {
    this.count.textContent = '';
    this.text.textContent = text;
    this.stop();
  }

  question(p) {
    this.count.textContent = `Câu ${p.index + 1}/${p.total}`;
    this.text.textContent = p.text;
    this.duration = p.duration;
    this.deadline = performance.now() + p.remaining;
    this.frozen = null;
  }

  reveal(p) {
    this.count.textContent = `Câu ${p.index + 1}/${p.total}`;
    this.text.textContent = p.text;
    this.stop();
  }

  pause() {
    if (this.deadline && this.frozen == null) this.frozen = Math.max(0, this.deadline - performance.now());
  }

  /* remaining: số ms còn lại theo server (chính xác hơn tự tính) */
  resume(remaining) {
    if (this.frozen == null) return;
    this.deadline = performance.now() + (remaining ?? this.frozen);
    this.frozen = null;
  }

  stop() {
    this.frozen = null;
    this.deadline = 0;
    this.timer.textContent = '';
    this.fill.style.width = '0%';
    this.fill.classList.remove('urgent');
  }

  tick() {
    if (!this.deadline) return;
    const left = this.frozen ?? Math.max(0, this.deadline - performance.now());
    this.timer.textContent = `${Math.ceil(left / 1000)}s`;
    this.fill.style.width = `${(left / this.duration) * 100}%`;
    this.fill.classList.toggle('urgent', left < 5000);
  }
}

/*
 * Gắn các sự kiện chung từ server vào sân chơi; trả về hàm áp dụng phase (dùng khi vừa vào phòng).
 * onPause(paused) được gọi mỗi khi trận đấu tạm dừng / tiếp tục.
 */
function bindGame(socket, arena, bar, onPhase, onPause) {
  socket.on('roster', (list) => arena.setRoster(list));
  socket.on('pos', (list) => arena.setPositions(list));
  socket.on('hazard:picked', ({ hazardId }) => arena.picked.add(hazardId));
  socket.on('player:hit', ({ playerId, hazardId, blocked }) => arena.onHit(playerId, hazardId, blocked));

  let paused = false;
  const setPaused = (value, info = {}) => {
    if (value === paused) return;
    paused = value;
    if (value) bar.pause();
    else bar.resume(info.remaining);
    arena.setPaused(value);
    $('#pause-overlay').classList.toggle('hidden', !value);
    onPause?.(value);
  };
  socket.on('pause', (x) => setPaused(x.paused, x));

  const apply = (p) => {
    if (p.phase === 'question') {
      arena.answers = p.answers;
      arena.correct = null;
      // Mốc thời gian của thử thách tính từ lúc câu hỏi bắt đầu trên server
      arena.setHazards(p.hazards, performance.now() - (p.duration - p.remaining));
      bar.question(p);
    } else if (p.phase === 'reveal') {
      arena.answers = p.answers;
      arena.correct = p.correct;
      arena.setHazards([]);
      bar.reveal(p);
      arena.showResults(p.results);
    } else {
      if (p.phase === 'lobby') {
        arena.answers = null;
        arena.correct = null;
      }
      arena.setHazards([]);
    }
    onPhase(p);
    setPaused(Boolean(p.paused), p);
  };
  socket.on('phase', apply);
  return apply;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/* Nhân vật giống trong sân chơi (Arena.drawPlayer), dạng SVG để dùng ngoài canvas, nhìn thẳng */
function characterSvg(color, { size = 32, crown = false } = {}) {
  const top = crown ? -64 : -46;
  const svg = svgEl('svg', {
    viewBox: `-24 ${top} 48 ${6 - top}`, width: size, height: Math.round((size * (6 - top)) / 48),
    class: 'character', 'aria-hidden': 'true',
  });
  svg.append(
    svgEl('ellipse', { cx: 0, cy: 2, rx: 17, ry: 4, fill: 'rgba(0,0,0,.3)' }),
    svgEl('rect', { x: -17, y: -42, width: 34, height: 40, rx: 13, fill: color, stroke: 'rgba(0,0,0,.4)', 'stroke-width': 2 }),
    svgEl('ellipse', { cx: -8, cy: -2, rx: 6, ry: 3.5, fill: 'rgba(0,0,0,.45)' }),
    svgEl('ellipse', { cx: 8, cy: -2, rx: 6, ry: 3.5, fill: 'rgba(0,0,0,.45)' }),
  );
  for (const dx of [-6, 6]) {
    svg.append(
      svgEl('circle', { cx: dx, cy: -29, r: 5.5, fill: '#fff' }),
      svgEl('circle', { cx: dx, cy: -28, r: 2.6, fill: '#111' }),
    );
  }
  if (crown) {
    svg.append(svgEl('path', {
      d: 'M-12 -45 L-13 -58 L-6 -51 L0 -62 L6 -51 L13 -58 L12 -45 Z',
      fill: '#ffd43b', stroke: '#c98a00', 'stroke-width': 1.5, 'stroke-linejoin': 'round',
    }));
  }
  return svg;
}

/*
 * Bảng xếp hạng cuối ván. animate: công bố dần từ hạng thấp lên, rồi bục hạng 3 → 2 → 1 và confetti.
 * Trả về số ms tới khi công bố xong (để hiện các nút sau đó).
 */
function renderLeaderboard(box, list, meId, { animate = false } = {}) {
  box.replaceChildren();
  box.classList.toggle('lb-anim', animate && !reducedMotion());
  if (!list.length) {
    box.append(el('p', 'muted', 'Không có người chơi nào.'));
    return 0;
  }

  const rest = list.slice(3);
  const restStep = rest.length ? Math.min(0.35, 3 / rest.length) : 0;
  const podiumAt = rest.length ? rest.length * restStep + 0.4 : 0.3;
  const stepDelay = { 3: podiumAt, 2: podiumAt + 0.9, 1: podiumAt + 1.9 };

  const podium = el('div', 'podium');
  for (const i of [1, 0, 2]) {
    const p = list[i];
    if (!p) continue;
    const step = el('div', `step step-${i + 1}${p.id === meId ? ' me' : ''}`);
    step.style.setProperty('--d', `${stepDelay[i + 1]}s`);
    step.append(
      characterSvg(p.color, { size: i === 0 ? 76 : 60, crown: i === 0 }),
      el('div', 'pname', p.name),
      el('div', 'pscore', `${p.score} điểm`),
      el('div', 'pcorrect', `${p.correct} câu đúng`),
      el('div', 'block', String(i + 1)),
    );
    podium.append(step);
  }
  box.append(podium);

  if (rest.length) {
    const ol = el('ol', 'rest');
    rest.forEach((p, i) => {
      const li = el('li', p.id === meId ? 'me' : '');
      // Hạng thấp nhất hiện trước
      li.style.setProperty('--d', `${(rest.length - 1 - i) * restStep}s`);
      li.append(
        characterSvg(p.color, { size: 26 }),
        el('span', 'pname', p.name),
        el('span', 'pcorrect', `${p.correct} câu đúng`),
        el('span', 'pscore', String(p.score)),
      );
      ol.append(li);
    });
    box.append(ol);
  }

  if (!box.classList.contains('lb-anim')) return 0;
  const championAt = (list.length >= 1 ? stepDelay[1] : 0) * 1000;
  setTimeout(() => confetti(), championAt + 500);
  return championAt + 900;
}

/*
 * Bảng xếp hạng tạm thời giữa các câu: các dòng bắt đầu ở thứ hạng cũ rồi trượt về thứ hạng mới,
 * điểm đếm dần lên. Người chơi luôn thấy dòng của mình (dù ngoài top).
 */
function renderStandings(box, list, { meId, limit = 10 } = {}) {
  const ROW = 56;
  let rows = list.slice(0, limit);
  const me = list.find((p) => p.id === meId);
  if (me && me.rank > limit) rows = [...list.slice(0, limit - 1), me];
  const before = [...rows].sort((a, b) => (a.prevRank ?? a.rank) - (b.prevRank ?? b.rank));
  const animate = !reducedMotion() && rows.some((p) => p.prevRank != null);

  box.replaceChildren();
  box.className = 'standings-list';
  box.style.height = `${rows.length * ROW}px`;

  const items = rows.map((p, i) => {
    const diff = p.prevRank ? p.prevRank - p.rank : 0;
    const row = el('div', `st-row${p.id === meId ? ' me' : ''}${p === me && me.rank > limit ? ' outside' : ''}`);
    const rank = el('span', 'st-rank', `#${animate ? p.prevRank ?? p.rank : p.rank}`);
    const score = el('span', 'st-score', String(animate ? p.score - p.gained : p.score));
    row.append(
      rank,
      characterSvg(p.color, { size: 28 }),
      el('span', 'st-name', p.name),
      el('span', `st-change ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`, diff > 0 ? `▲${diff}` : diff < 0 ? `▼${-diff}` : ''),
      el('span', 'st-gain', p.gained ? `+${p.gained}` : ''),
      score,
    );
    row.style.transform = `translateY(${(animate ? before.indexOf(p) : i) * ROW}px)`;
    box.append(row);
    return { row, rank, score, p, i };
  });

  if (!animate) {
    box.classList.add('settled');
    return;
  }
  // Cho người xem thấy thứ hạng cũ một chút rồi mới đổi chỗ
  setTimeout(() => {
    box.classList.add('settled');
    for (const { row, rank, score, p, i } of items) {
      row.style.transform = `translateY(${i * ROW}px)`;
      rank.textContent = `#${p.rank}`;
      countUp(score, p.score - p.gained, p.score, 900);
    }
  }, 900);
}

function countUp(node, from, to, ms) {
  const start = performance.now();
  const frame = (t) => {
    const k = Math.min(1, (t - start) / ms);
    node.textContent = String(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function confetti(ms = 4000) {
  if (reducedMotion()) return;
  const canvas = el('canvas', 'confetti');
  document.body.append(canvas);
  const c = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  const colors = ['#ffd43b', '#ff6b6b', '#4dabf7', '#69db7c', '#da77f2', '#ffa94d'];
  const parts = Array.from({ length: 180 }, (_, i) => ({
    x: Math.random() * innerWidth,
    y: -20 - Math.random() * innerHeight * 0.6,
    vx: (Math.random() - 0.5) * 140,
    vy: 140 + Math.random() * 240,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 9,
    w: 6 + Math.random() * 6,
    h: 9 + Math.random() * 8,
    color: colors[i % colors.length],
  }));
  const start = performance.now();
  let last = start;
  const frame = (t) => {
    const dt = (t - last) / 1000;
    last = t;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, innerWidth, innerHeight);
    c.globalAlpha = Math.max(0, Math.min(1, (start + ms - t) / 700));
    for (const p of parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.r);
      c.fillStyle = p.color;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
    }
    if (t - start < ms) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

function runLoop(fn) {
  let last = performance.now();
  const frame = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    fn(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
