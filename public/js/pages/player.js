'use strict';
const SPEED = 320;
const GRAVITY = 2000;
const JUMP_V = 760;
const ACCEL = 4000; // tăng/giảm tốc bình thường: gần như tức thì
const ICE_ACCEL = 600; // trên băng: trơn, khó dừng
const STUN_DECEL = 1500; // bị hất văng thì trượt đi một đoạn rồi mới dừng
const SEND_MS = 50;
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
};

const socket = io();
const arena = new Arena($('#arena'));
const bar = new QuestionBar();
const me = { x: W / 2, y: GROUND, vx: 0, vy: 0, f: 1, onGround: true, stunUntil: 0 };
const input = { left: false, right: false, jump: false };
const SESSION_KEY = 'quiz-player-session';
let phase = 'lobby';
let questionIndex = null; // gửi kèm vị trí để server biết gói tin thuộc câu nào
let lastSent = 0;
let lastKey = '';
let handled = new Set(); // thiên thạch/khiên của câu này đã xử lý xong

/* Phiên chơi {pin, name, token} lưu theo từng tab: reload trang thì tự vào lại đúng nhân vật */
function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function saveSession(s) {
  session = s;
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* trình duyệt chặn storage: vẫn chơi được, chỉ không vào lại khi reload */ }
}

let session = loadSession();
const params = new URLSearchParams(location.search);
$('#pin').value = session?.pin || params.get('pin') || '';
$('#name').value = session?.name || '';
if (session) $('#join-error').textContent = 'Đang vào lại phòng…';
else ($('#pin').value ? $('#name') : $('#pin')).focus();

function join(pin, name, token) {
  return new Promise((resolve) => socket.emit('player:join', { pin, name, token }, resolve));
}

function setScore(score) {
  $('#my-score').textContent = score;
}

function banner(html, cls = '') {
  const b = $('#banner');
  b.className = `banner ${cls}`;
  b.replaceChildren(...html);
}

function hideBanner() {
  $('#banner').classList.add('hidden');
}

function enterRoom(res) {
  arena.selfId = res.id;
  Object.assign(me, { x: res.x, y: GROUND, vx: 0, vy: 0, stunUntil: 0 });
  lastKey = '';
  handled = new Set();
  setScore(res.score);
  showScreen('game');
  applyPhase(res.phase);
}

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('#pin').value.trim();
  const name = $('#name').value.trim();
  $('#join-btn').disabled = true;
  const res = await join(pin, name);
  $('#join-btn').disabled = false;
  if (!res.ok) {
    $('#join-error').textContent = res.error;
    return;
  }
  $('#join-error').textContent = '';
  saveSession({ pin, name, token: res.token });
  history.replaceState(null, '', `/?pin=${pin}`);
  enterRoom(res);
});

const applyPhase = bindGame(socket, arena, bar, (p) => {
  phase = p.phase;
  questionIndex = p.phase === 'question' ? p.index : null;
  if (p.phase === 'lobby') {
    hideBanner();
    setScore(0);
    bar.message(p.difficulty && p.difficulty !== 'off'
      ? 'Đã vào phòng! Chờ chủ phòng bắt đầu… Cẩn thận thiên thạch ☄️, gió 🌬️ và sàn băng 🧊, nhặt khiên 🛡️ để đỡ đòn!'
      : 'Đã vào phòng! Chờ chủ phòng bắt đầu… Thử chạy nhảy cho quen tay nhé 🎮');
    showScreen('game');
  } else if (p.phase === 'question') {
    hideBanner();
    const x = p.spawn?.[arena.selfId];
    if (x != null) Object.assign(me, { x, y: GROUND, vx: 0, vy: 0, stunUntil: 0 });
    handled = new Set();
    showScreen('game');
  } else if (p.phase === 'reveal') {
    const r = p.results[arena.selfId];
    const answer = `${LETTERS[p.correct]}. ${p.answers[p.correct]}`;
    if (!r) {
      banner([document.createTextNode(`Đáp án đúng: ${answer}`)]);
    } else if (r.correct) {
      setScore(r.score);
      banner([document.createTextNode(`✔ Chính xác! +${r.gained}`), el('small', '', `Tổng: ${r.score} điểm`)], 'good');
    } else {
      setScore(r.score);
      banner([document.createTextNode('✘ Sai rồi!'), el('small', '', `Đáp án đúng: ${answer}`)], 'bad');
    }
  } else if (p.phase === 'ended') {
    const rank = p.leaderboard.findIndex((x) => x.id === arena.selfId);
    $('#my-rank').textContent = rank >= 0
      ? `Bạn xếp hạng #${rank + 1} với ${p.leaderboard[rank].score} điểm`
      : '';
    renderLeaderboard($('#board'), p.leaderboard, arena.selfId);
    showScreen('end');
  }
});

socket.on('room:closed', ({ reason }) => {
  saveSession(null);
  arena.selfId = null;
  $('#join-error').textContent = reason;
  showScreen('join');
});

socket.on('disconnect', () => {
  if (session) $('#notice').textContent = 'Mất kết nối, đang thử kết nối lại…';
  $('#notice').classList.toggle('hidden', !session);
});

socket.on('connect', async () => {
  $('#notice').classList.add('hidden');
  if (!session) return;
  // Vào lại phòng bằng đúng tên cũ để giữ điểm (sau khi rớt mạng hoặc reload trang)
  const res = await join(session.pin, session.name, session.token);
  if (res.ok) {
    $('#join-error').textContent = '';
    enterRoom(res);
  } else {
    saveSession(null);
    $('#join-error').textContent = res.error;
    showScreen('join');
  }
});

// ---------- Điều khiển ----------
addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (!session || !k) return;
  input[k] = true;
  e.preventDefault();
});
addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) input[k] = false;
});
addEventListener('blur', () => {
  input.left = input.right = input.jump = false;
});

for (const b of document.querySelectorAll('.controls [data-key]')) {
  const k = b.dataset.key;
  const off = () => { input[k] = false; b.classList.remove('active'); };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    input[k] = true;
    b.classList.add('active');
    b.setPointerCapture(e.pointerId);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, off);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}

const approach = (v, target, delta) => (v < target ? Math.min(target, v + delta) : Math.max(target, v - delta));

function step(dt) {
  const now = performance.now();
  const t = arena.hazardTime();
  const live = phase === 'question';
  const stunned = now < me.stunUntil;
  const canMove = (phase === 'lobby' || live) && !stunned;
  const dir = canMove ? Number(input.right) - Number(input.left) : 0;
  if (dir) me.f = dir;

  if (phase === 'reveal' || phase === 'ended') {
    me.vx = 0; // đứng yên để mọi người nhìn rõ ai đứng ô nào
  } else {
    const onIce = live && me.onGround && iceAt(arena.hazards, t, me.x);
    const rate = stunned ? (onIce ? ICE_ACCEL / 2 : STUN_DECEL) : (onIce ? ICE_ACCEL : ACCEL);
    me.vx = approach(me.vx, dir * SPEED, rate * dt);
    const wind = live ? windAt(arena.hazards, t) * WIND_SPEED : 0;
    me.x += (me.vx + wind) * dt;
  }
  if (me.x < 18 || me.x > W - 18) {
    me.x = Math.min(W - 18, Math.max(18, me.x));
    me.vx = 0;
  }

  if (input.jump && me.onGround && !stunned) {
    me.vy = -JUMP_V;
    me.onGround = false;
  }
  me.vy += GRAVITY * dt;
  me.y += me.vy * dt;
  if (me.y >= GROUND) {
    me.y = GROUND;
    me.vy = 0;
    me.onGround = true;
  }

  if (live) checkHazards(t, now);
}

/* Mỗi máy tự kiểm tra nhân vật của mình, rồi báo server để mọi người cùng thấy */
function checkHazards(t, now) {
  for (const h of arena.hazards) {
    if (handled.has(h.id)) continue;
    if (h.type === 'meteor' && t >= h.at) {
      handled.add(h.id);
      if (t - h.at > 250) continue; // vừa vào phòng giữa chừng: bỏ qua thiên thạch đã rơi
      if (Math.abs(me.x - h.x) > METEOR_HIT_X || GROUND - me.y > METEOR_HIT_H) continue;
      if (arena.hasShield(arena.selfId)) {
        arena.onHit(arena.selfId, h.id, true); // dự đoán trước, server sẽ xác nhận
      } else {
        const away = Math.sign(me.x - h.x) || (Math.random() < 0.5 ? -1 : 1);
        me.vx = away * KNOCK_VX;
        me.vy = -KNOCK_VY;
        me.onGround = false;
        me.stunUntil = now + STUN_MS;
        arena.onHit(arena.selfId, h.id, false);
      }
      socket.emit('player:hit', { hazardId: h.id, q: questionIndex });
    } else if (h.type === 'shield' && !arena.picked.has(h.id) && !arena.hasShield(arena.selfId)) {
      const pos = shieldPos(h, t);
      if (pos && Math.hypot(me.x - pos.x, me.y - 22 - pos.y) < SHIELD_PICK) {
        handled.add(h.id);
        socket.emit('player:pickup', { hazardId: h.id, q: questionIndex });
      }
    }
  }
}

function send(now) {
  if (now - lastSent < SEND_MS) return;
  const x = Math.round(me.x);
  const y = Math.round(me.y);
  const key = `${x},${y},${me.f},${questionIndex}`;
  if (key === lastKey) return;
  lastSent = now;
  lastKey = key;
  socket.emit('player:move', { x, y, f: me.f, q: questionIndex });
}

runLoop((dt) => {
  if (session && socket.connected) {
    step(dt);
    send(performance.now());
    arena.setSelf(me.x, me.y, me.f);
  }
  arena.update(dt);
  arena.draw();
  bar.tick();
});
