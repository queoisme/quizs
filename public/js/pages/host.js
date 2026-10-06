'use strict';
const socket = io();
const arena = new Arena($('#arena'));
const bar = new QuestionBar();
const params = new URLSearchParams(location.search);
const SESSION_KEY = 'quiz-host-session';
let room = null;

/* {pin, hostKey} lưu theo tab: reload trang thì nhận lại đúng phòng đang chạy */
function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function saveSession(s) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* trình duyệt chặn storage: reload sẽ mất phòng */ }
}

function showRoom(res) {
  room = res;
  room.sub = `Thử thách: ${res.difficulty}`;
  saveSession({ pin: res.pin, hostKey: res.hostKey });
  $('#qr').src = res.qr;
  $('#join-url').textContent = res.url.replace(/^https?:\/\//, '');
  $('#join-url').href = res.url;
  $('#pin').textContent = res.pin;
  $('#corner-pin').textContent = res.pin;
  $('#lobby-title').textContent = res.title;
  $('#lobby-sub').textContent = `${res.total} câu hỏi · ${room.sub}`;
  $('#lan-hint').classList.toggle('hidden', !/^http:\/\/(\d+\.){3}\d+/.test(res.url));
}

async function loadQuizzes() {
  const box = $('#quiz-list');
  let list;
  try {
    const res = await fetch('/api/quizzes');
    if (res.status === 401) {
      location.href = loginUrl();
      return;
    }
    list = await res.json();
  } catch {
    $('#setup-error').textContent = 'Không tải được danh sách bộ câu hỏi';
    return;
  }
  box.replaceChildren();
  if (!list.length) {
    const p = el('p', 'muted', 'Chưa có bộ câu hỏi nào. ');
    const a = el('a', '', 'Tạo bộ đầu tiên');
    a.href = '/editor';
    p.append(a);
    box.append(p);
    return;
  }
  const want = params.get('quiz');
  for (const q of list) {
    const label = el('label', 'quiz-item');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'quiz';
    radio.value = q.id;
    radio.checked = q.id === want;
    label.append(radio, el('span', 'qt', q.title), el('span', 'muted', `${q.count} câu`));
    box.append(label);
  }
  if (!box.querySelector('input:checked')) box.querySelector('input').checked = true;
  $('#create-room').disabled = false;
}

$('#create-room').addEventListener('click', () => {
  const quizId = document.querySelector('input[name=quiz]:checked')?.value;
  const difficulty = document.querySelector('input[name=difficulty]:checked')?.value;
  if (!quizId) return;
  $('#create-room').disabled = true;
  socket.emit('host:create', { quizId, difficulty }, (res) => {
    $('#create-room').disabled = false;
    if (res.login) {
      location.href = loginUrl();
      return;
    }
    if (!res.ok) {
      $('#setup-error').textContent = res.error;
      return;
    }
    showRoom(res);
    bar.message('');
    showScreen('lobby');
  });
});

socket.on('roster', (list) => {
  const box = $('#players');
  box.replaceChildren(...list.map((p) => {
    const chip = el('span', 'chip', p.name);
    chip.style.background = p.color;
    return chip;
  }));
  $('#player-count').textContent = list.length;
  $('#corner-count').textContent = list.length;
  $('#start').disabled = list.length === 0;
});

$('#start').addEventListener('click', () => {
  $('#start').disabled = true;
  socket.emit('host:start', null, (res) => {
    if (!res.ok) {
      $('#lobby-error').textContent = res.error;
      $('#start').disabled = false;
    } else {
      $('#lobby-error').textContent = '';
    }
  });
});

$('#restart').addEventListener('click', () => {
  socket.emit('host:restart', null, (res) => {
    $('#end-error').textContent = res.ok ? '' : res.error;
    if (res.ok) $('#lobby-sub').textContent = `${res.total} câu hỏi · ${room.sub}`;
  });
});

$('#logout').addEventListener('click', logout);

$('#new-game').addEventListener('click', () => {
  socket.emit('host:leave', null, () => {
    saveSession(null);
    location.href = '/host';
  });
});

const applyPhase = bindGame(socket, arena, bar, (p) => {
  const b = $('#banner');
  if (p.phase === 'lobby') {
    b.classList.add('hidden');
    $('#start').disabled = $('#players').childElementCount === 0;
    showScreen('lobby');
  } else if (p.phase === 'question') {
    b.classList.add('hidden');
    showScreen('game');
  } else if (p.phase === 'reveal') {
    const top = el('ol');
    for (const t of p.top) {
      const li = el('li', '', t.name);
      li.append(el('span', '', String(t.score)));
      top.append(li);
    }
    b.className = 'banner good';
    b.replaceChildren(
      document.createTextNode(`Đáp án: ${LETTERS[p.correct]}. ${p.answers[p.correct]}`),
      el('small', '', `${p.stats.right}/${p.stats.total} người trả lời đúng${p.isLast ? ' · Câu cuối!' : ''}`),
      top,
    );
  } else if (p.phase === 'ended') {
    renderLeaderboard($('#board'), p.leaderboard);
    showScreen('end');
  }
});

socket.on('disconnect', () => {
  if (!room) return;
  $('#notice').textContent = 'Mất kết nối với server, đang kết nối lại…';
  $('#notice').classList.remove('hidden');
});

/* Lần đầu mở trang, reload, hoặc mạng chập chờn: nhận lại phòng nếu còn */
socket.on('connect', () => {
  const saved = loadSession();
  if (!saved) return;
  socket.emit('host:resume', saved, (res) => {
    $('#notice').classList.add('hidden');
    if (res.login) {
      location.href = loginUrl();
      return;
    }
    if (!res.ok) {
      saveSession(null);
      room = null;
      $('#setup-error').textContent = 'Phòng cũ đã đóng, hãy tạo phòng mới.';
      showScreen('setup');
      return;
    }
    showRoom(res);
    applyPhase(res.phase);
  });
});

loadQuizzes();

runLoop((dt) => {
  arena.update(dt);
  arena.draw();
  bar.tick();
});
