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
  }

  reveal(p) {
    this.count.textContent = `Câu ${p.index + 1}/${p.total}`;
    this.text.textContent = p.text;
    this.stop();
  }

  stop() {
    this.deadline = 0;
    this.timer.textContent = '';
    this.fill.style.width = '0%';
    this.fill.classList.remove('urgent');
  }

  tick() {
    if (!this.deadline) return;
    const left = Math.max(0, this.deadline - performance.now());
    this.timer.textContent = `${Math.ceil(left / 1000)}s`;
    this.fill.style.width = `${(left / this.duration) * 100}%`;
    this.fill.classList.toggle('urgent', left < 5000);
  }
}

/* Gắn các sự kiện chung từ server vào sân chơi; trả về hàm áp dụng phase (dùng khi vừa vào phòng). */
function bindGame(socket, arena, bar, onPhase) {
  socket.on('roster', (list) => arena.setRoster(list));
  socket.on('pos', (list) => arena.setPositions(list));
  socket.on('hazard:picked', ({ hazardId }) => arena.picked.add(hazardId));
  socket.on('player:hit', ({ playerId, hazardId, blocked }) => arena.onHit(playerId, hazardId, blocked));
  const apply = (p) => {
    if (p.phase === 'lobby') {
      arena.answers = null;
      arena.correct = null;
      arena.setHazards([]);
    } else if (p.phase === 'question') {
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
    }
    onPhase(p);
  };
  socket.on('phase', apply);
  return apply;
}

function renderLeaderboard(box, list, meId) {
  box.replaceChildren();
  if (!list.length) {
    box.append(el('p', 'muted', 'Không có người chơi nào.'));
    return;
  }
  const podium = el('div', 'podium');
  for (const i of [1, 0, 2]) {
    const p = list[i];
    if (!p) continue;
    const step = el('div', `step step-${i + 1}${p.id === meId ? ' me' : ''}`);
    const avatar = el('div', 'avatar');
    avatar.style.background = p.color;
    step.append(avatar, el('div', 'pname', p.name), el('div', 'pscore', `${p.score} điểm`), el('div', 'block', String(i + 1)));
    podium.append(step);
  }
  box.append(podium);

  if (list.length > 3) {
    const ol = el('ol', 'rest');
    for (const p of list.slice(3)) {
      const li = el('li', p.id === meId ? 'me' : '');
      li.append(el('span', 'pname', p.name), el('span', 'pcorrect', `${p.correct} câu đúng`), el('span', 'pscore', String(p.score)));
      ol.append(li);
    }
    box.append(ol);
  }
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
