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

// ---------- Chọn bộ câu hỏi ----------

const STEP_OVERHEAD_SEC = 9; // hiện đáp án + bảng xếp hạng giữa các câu
let quizzes = [];
let selectedId = params.get('quiz');
const previews = new Map(); // id -> bộ câu hỏi đầy đủ (đã tải)

/* Bỏ dấu để tìm "chu nghia" vẫn ra "Chủ nghĩa" */
const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

const fmtDuration = (sec) => (sec < 90 ? `${sec} giây` : `~${Math.round(sec / 60)} phút`);

function fmtDate(iso) {
  const d = new Date(iso);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((day(new Date()) - day(d)) / 864e5);
  if (days <= 0) return 'hôm nay';
  if (days === 1) return 'hôm qua';
  if (days < 7) return `${days} ngày trước`;
  return d.toLocaleDateString('vi-VN');
}

async function loadQuizzes() {
  try {
    const res = await fetch('/api/quizzes');
    if (res.status === 401) {
      location.href = loginUrl();
      return;
    }
    quizzes = await res.json();
  } catch {
    $('#setup-error').textContent = 'Không tải được danh sách bộ câu hỏi';
    return;
  }
  $('#picker-tools').classList.toggle('hidden', quizzes.length === 0);
  if (!quizzes.some((q) => q.id === selectedId)) selectedId = quizzes[0]?.id ?? null; // mới sửa gần nhất
  renderQuizList();
  if (selectedId) selectQuiz(selectedId);
  else renderPreview(null);
}

function renderQuizList() {
  const box = $('#quiz-list');
  const term = fold($('#quiz-search').value.trim());
  const sorters = {
    recent: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
    name: (a, b) => a.title.localeCompare(b.title, 'vi'),
    count: (a, b) => b.count - a.count,
  };
  const shown = quizzes.filter((q) => !term || fold(q.title).includes(term)).sort(sorters[$('#quiz-sort').value]);
  $('#quiz-count').textContent = term ? `${shown.length}/${quizzes.length} bộ` : `${quizzes.length} bộ`;

  box.replaceChildren(...shown.map((q) => {
    const card = el('label', `quiz-card${q.id === selectedId ? ' selected' : ''}`);
    const radio = el('input');
    Object.assign(radio, { type: 'radio', name: 'quiz', value: q.id, checked: q.id === selectedId });
    radio.addEventListener('change', () => selectQuiz(q.id));
    card.append(
      radio,
      el('strong', 'qc-title', q.title),
      el('span', 'qc-meta', `${q.count} câu · ${fmtDuration(q.totalSec + q.count * STEP_OVERHEAD_SEC)}`),
      el('span', 'qc-date', `Sửa ${fmtDate(q.updatedAt)}`),
    );
    return card;
  }));

  if (!quizzes.length) {
    const p = el('p', 'empty-note muted', 'Chưa có bộ câu hỏi nào. ');
    const a = el('a', '', 'Tạo bộ đầu tiên');
    a.href = '/editor';
    p.append(a);
    box.append(p);
  } else if (!shown.length) {
    box.append(el('p', 'empty-note muted', `Không có bộ nào khớp “${$('#quiz-search').value.trim()}”`));
  }
}

async function selectQuiz(id) {
  selectedId = id;
  $('#create-room').disabled = false;
  for (const card of document.querySelectorAll('.quiz-card')) {
    card.classList.toggle('selected', card.querySelector('input').value === id);
  }
  if (!previews.has(id)) {
    renderPreview(undefined);
    try {
      const res = await fetch(`/api/quizzes/${id}`);
      if (res.ok) previews.set(id, await res.json());
    } catch { /* hiện lỗi bên dưới */ }
  }
  if (selectedId === id) renderPreview(previews.get(id) ?? null); // bỏ qua nếu đã chọn bộ khác trong lúc tải
}

/* quiz: object = hiện xem trước; undefined = đang tải; null = không có gì để xem */
function renderPreview(quiz) {
  const box = $('#quiz-preview');
  if (quiz === undefined) {
    box.replaceChildren(el('p', 'muted', 'Đang tải…'));
    return;
  }
  if (!quiz) {
    box.replaceChildren(el('p', 'muted', quizzes.length ? 'Không tải được bộ câu hỏi này.' : 'Chọn một bộ câu hỏi để xem trước.'));
    return;
  }
  const ol = el('ol', 'qp-list');
  for (const q of quiz.questions.slice(0, 3)) ol.append(el('li', '', q.question));
  const more = quiz.questions.length - 3;
  const edit = el('a', 'btn ghost', '✎ Sửa bộ này');
  edit.href = `/editor?id=${quiz.id}`;
  box.replaceChildren(
    el('span', 'qp-label muted', 'Xem trước'),
    el('h3', 'qp-title', quiz.title),
    ol,
    ...(more > 0 ? [el('p', 'muted qp-more', `…và ${more} câu nữa`)] : []),
    edit,
  );
}

$('#quiz-search').addEventListener('input', renderQuizList);
$('#quiz-sort').addEventListener('change', renderQuizList);

$('#create-room').addEventListener('click', () => {
  const difficulty = document.querySelector('input[name=difficulty]:checked')?.value;
  if (!selectedId) return;
  $('#create-room').disabled = true;
  socket.emit('host:create', { quizId: selectedId, difficulty }, (res) => {
    $('#create-room').disabled = false;
    if (res.login) {
      location.href = loginUrl();
      return;
    }
    if (!res.ok) {
      $('#setup-error').textContent = res.error;
      return;
    }
    $('#setup-error').textContent = '';
    showRoom(res);
    bar.message('');
    showScreen('lobby');
  });
});

// ---------- Sảnh chờ ----------

socket.on('roster', (list) => {
  const box = $('#players');
  box.replaceChildren(...list.map((p) => {
    const chip = el('span', 'chip');
    chip.style.borderColor = p.color;
    chip.append(characterSvg(p.color, { size: 22 }), el('span', '', p.name));
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

$('#cancel-room').addEventListener('click', () => {
  const n = Number($('#player-count').textContent);
  if (n > 0 && !confirm(`Huỷ phòng? ${n} người chơi sẽ bị đưa ra ngoài.`)) return;
  socket.emit('host:leave', null, () => {
    saveSession(null);
    room = null;
    $('#players').replaceChildren();
    $('#player-count').textContent = '0';
    $('#lobby-error').textContent = '';
    showScreen('setup');
    loadQuizzes();
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

// ---------- Điều khiển trận đấu ----------
let paused = false;
const hostAction = (event) => socket.emit(event, null, (res) => {
  if (res && !res.ok) {
    $('#notice').textContent = res.error;
    $('#notice').classList.remove('hidden');
    setTimeout(() => $('#notice').classList.add('hidden'), 3000);
  }
});
const togglePause = () => hostAction(paused ? 'host:resume' : 'host:pause');
const skip = () => hostAction('host:skip');

$('#pause-btn').addEventListener('click', togglePause);
$('#skip-btn').addEventListener('click', skip);
$('#end-btn').addEventListener('click', () => {
  if (confirm('Kết thúc trận ngay và công bố kết quả? Câu đang dở sẽ không được tính điểm.')) hostAction('host:end');
});
addEventListener('keydown', (e) => {
  if ($('#host-controls').classList.contains('hidden') || e.target.matches('input, textarea')) return;
  if (e.code === 'KeyP') togglePause();
  else if (e.code === 'KeyN') skip();
});

const applyPhase = bindGame(socket, arena, bar, (p) => {
  const b = $('#banner');
  const playing = p.phase === 'question' || p.phase === 'reveal' || p.phase === 'standings';
  $('#host-controls').classList.toggle('hidden', !playing);
  if (p.phase === 'lobby') {
    b.classList.add('hidden');
    $('#start').disabled = $('#players').childElementCount === 0;
    showScreen('lobby');
  } else if (p.phase === 'question') {
    b.classList.add('hidden');
    showScreen('game');
  } else if (p.phase === 'reveal') {
    b.className = 'banner good';
    b.replaceChildren(
      document.createTextNode(`Đáp án: ${LETTERS[p.correct]}. ${p.answers[p.correct]}`),
      el('small', '', `${p.stats.right}/${p.stats.total} người trả lời đúng${p.isLast ? ' · Câu cuối!' : ''}`),
    );
    showScreen('game');
  } else if (p.phase === 'standings') {
    $('#st-progress').textContent = `Sau câu ${p.index + 1}/${p.total}`;
    renderStandings($('#standings-list'), p.list, { limit: 10 });
    showScreen('standings');
  } else if (p.phase === 'ended') {
    const actions = $('#end-actions');
    actions.classList.add('reveal-later');
    actions.classList.remove('shown');
    const ms = renderLeaderboard($('#board'), p.leaderboard, null, { animate: true });
    setTimeout(() => actions.classList.add('shown'), ms);
    showScreen('end');
  }
}, (value) => {
  paused = value;
  $('#pause-btn').textContent = value ? '▶ Tiếp tục' : '⏸ Tạm dừng';
  $('#pause-btn').classList.toggle('resume', value);
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
