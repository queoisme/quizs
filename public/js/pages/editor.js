'use strict';

let quizzes = [];
let current = null; // {id|null, title, questions}
let dirty = false;
let dragFrom = null;
let toastTimer = null;

const blankQuestion = (time = 15) => ({ question: '', answers: ['', '', '', ''], correct: 0, time });
const isBlank = (q) => !q.question.trim() && q.answers.every((a) => !a.trim());

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // Đang xem thì chuyển sang đăng nhập; đang lưu thì giữ nguyên trang để không mất phần đang soạn
    if (method === 'GET') {
      location.href = loginUrl();
      return new Promise(() => {}); // chờ chuyển trang, không hiện lỗi
    }
    const err = new Error('unauthorized');
    err.list = ['Phiên đăng nhập đã hết hạn. Hãy mở trang /login ở tab mới để đăng nhập lại, rồi quay lại đây bấm Lưu (phần đang soạn vẫn còn).'];
    throw err;
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error('request failed');
    err.list = data?.errors || [`Lỗi ${res.status}`];
    throw err;
  }
  return data;
}

function setDirty(v) {
  dirty = v;
  $('#status').textContent = v ? '● Chưa lưu' : (current?.id ? '✓ Đã lưu' : '');
}

const confirmDiscard = () => !dirty || confirm('Bạn có thay đổi chưa lưu. Bỏ qua các thay đổi này?');

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 1800);
}

function showErrors(list) {
  const box = $('#errors');
  const ul = el('ul');
  for (const m of list) ul.append(el('li', '', m));
  box.replaceChildren(ul);
  box.classList.remove('hidden');
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const hideErrors = () => $('#errors').classList.add('hidden');

// ---------- Danh sách bộ câu hỏi ----------

async function loadList() {
  quizzes = await api('GET', '/api/quizzes');
  renderList();
}

function renderList() {
  const ul = $('#quiz-list');
  ul.replaceChildren();
  if (!quizzes.length) ul.append(el('li', 'muted', 'Chưa có bộ nào'));
  for (const q of quizzes) {
    const li = el('li', q.id === current?.id ? 'active' : '');
    const btn = el('button');
    btn.type = 'button';
    btn.append(el('strong', '', q.title), el('small', '', `${q.count} câu`));
    btn.addEventListener('click', () => {
      if (q.id !== current?.id && confirmDiscard()) openQuiz(q.id);
    });
    li.append(btn);
    ul.append(li);
  }
}

async function openQuiz(id) {
  try {
    current = await api('GET', `/api/quizzes/${id}`);
  } catch (err) {
    alert(err.list.join('\n'));
    return;
  }
  history.replaceState(null, '', `/editor?id=${id}`);
  dirty = false;
  renderEditor();
}

function newQuiz() {
  if (!confirmDiscard()) return;
  current = { id: null, title: '', questions: [blankQuestion()] };
  history.replaceState(null, '', '/editor');
  renderEditor();
  setDirty(true);
  $('#title').focus();
}

// ---------- Soạn câu hỏi ----------

function renderEditor() {
  $('#empty').classList.toggle('hidden', !!current);
  $('#form').classList.toggle('hidden', !current);
  renderList();
  hideErrors();
  if (!current) return;
  $('#title').value = current.title;
  $('#play').classList.toggle('hidden', !current.id);
  $('#delete').classList.toggle('hidden', !current.id);
  if (current.id) $('#play').href = `/host?quiz=${current.id}`;
  renderQuestions();
  setDirty(dirty);
}

function renderQuestions() {
  $('#questions').replaceChildren(...current.questions.map(renderQuestion));
}

function renderQuestion(q, i) {
  const card = el('article', 'q-card');
  card.dataset.index = i;

  const head = el('div', 'q-head');
  const handle = el('span', 'drag', '⠿');
  handle.title = 'Kéo để đổi thứ tự';
  const time = el('label', 'q-time', '⏱');
  const timeInput = el('input', 'in-time');
  Object.assign(timeInput, { type: 'number', min: 5, max: 120, step: 1, value: q.time });
  time.append(timeInput, document.createTextNode('giây'));
  const actions = el('div', 'q-actions');
  for (const [act, label, title] of [['up', '↑', 'Lên'], ['down', '↓', 'Xuống'], ['dup', '⧉', 'Nhân bản'], ['del', '✕', 'Xoá câu']]) {
    const b = el('button', act === 'del' ? 'danger' : '', label);
    Object.assign(b, { type: 'button', title });
    b.dataset.act = act;
    actions.append(b);
  }
  head.append(handle, el('strong', '', `Câu ${i + 1}`), time, actions);

  const text = el('textarea', 'in-question');
  Object.assign(text, { rows: 2, maxLength: 300, placeholder: 'Nhập nội dung câu hỏi…', value: q.question });

  const answers = el('div', 'answers');
  q.answers.forEach((a, j) => {
    const row = el('div', `ans ans-${j}${q.correct === j ? ' correct' : ''}`);
    const pick = el('label', 'pick');
    pick.title = 'Chọn làm đáp án đúng';
    const radio = el('input', 'in-correct');
    Object.assign(radio, { type: 'radio', name: `correct-${i}`, value: j, checked: q.correct === j });
    pick.append(radio, el('span', 'letter', LETTERS[j]));
    const input = el('input', 'in-answer');
    Object.assign(input, { type: 'text', maxLength: 120, placeholder: `Đáp án ${LETTERS[j]}`, value: a });
    input.dataset.j = j;
    row.append(pick, input);
    answers.append(row);
  });

  card.append(head, text, answers);
  return card;
}

const box = $('#questions');

box.addEventListener('input', (e) => {
  const card = e.target.closest('.q-card');
  if (!card) return;
  const q = current.questions[Number(card.dataset.index)];
  const t = e.target;
  if (t.classList.contains('in-question')) q.question = t.value;
  else if (t.classList.contains('in-answer')) q.answers[Number(t.dataset.j)] = t.value;
  else if (t.classList.contains('in-time')) q.time = Number(t.value);
  else if (t.classList.contains('in-correct')) {
    q.correct = Number(t.value);
    card.querySelectorAll('.ans').forEach((a, j) => a.classList.toggle('correct', j === q.correct));
  } else return;
  setDirty(true);
});

function move(from, to) {
  const [q] = current.questions.splice(from, 1);
  current.questions.splice(to, 0, q);
}

box.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const i = Number(btn.closest('.q-card').dataset.index);
  const qs = current.questions;
  switch (btn.dataset.act) {
    case 'up': if (i === 0) return; move(i, i - 1); break;
    case 'down': if (i === qs.length - 1) return; move(i, i + 1); break;
    case 'dup': qs.splice(i + 1, 0, structuredClone(qs[i])); break;
    case 'del':
      if (qs.length === 1) { alert('Bộ câu hỏi cần ít nhất 1 câu.'); return; }
      if (!isBlank(qs[i]) && !confirm(`Xoá câu ${i + 1}?`)) return;
      qs.splice(i, 1);
      break;
    default: return;
  }
  setDirty(true);
  renderQuestions();
});

// Kéo thả: chỉ cho kéo khi nắm vào tay cầm ⠿ để không cản việc bôi đen chữ
box.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.drag');
  if (handle) handle.closest('.q-card').draggable = true;
});
document.addEventListener('pointerup', () => {
  if (dragFrom == null) box.querySelectorAll('.q-card[draggable=true]').forEach((c) => { c.draggable = false; });
});
box.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.q-card');
  if (!card) return;
  dragFrom = Number(card.dataset.index);
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
});
box.addEventListener('dragover', (e) => {
  const card = e.target.closest('.q-card');
  if (dragFrom == null || !card) return;
  e.preventDefault();
  box.querySelectorAll('.drag-over').forEach((c) => c !== card && c.classList.remove('drag-over'));
  card.classList.add('drag-over');
});
box.addEventListener('drop', (e) => {
  e.preventDefault();
  const card = e.target.closest('.q-card');
  if (!card || dragFrom == null) return;
  const to = Number(card.dataset.index);
  if (to !== dragFrom) {
    move(dragFrom, to);
    setDirty(true);
  }
});
box.addEventListener('dragend', () => {
  dragFrom = null;
  renderQuestions();
});

$('#title').addEventListener('input', (e) => {
  current.title = e.target.value;
  setDirty(true);
});

$('#add-q').addEventListener('click', () => {
  const last = current.questions.at(-1);
  current.questions.push(blankQuestion(last?.time || 15));
  setDirty(true);
  renderQuestions();
  const cards = box.querySelectorAll('.q-card');
  const card = cards[cards.length - 1];
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.querySelector('textarea').focus({ preventScroll: true });
});

async function save() {
  if (!current) return;
  $('#save').disabled = true;
  try {
    const body = { title: current.title, questions: current.questions };
    current = current.id
      ? await api('PUT', `/api/quizzes/${current.id}`, body)
      : await api('POST', '/api/quizzes', body);
    dirty = false;
    history.replaceState(null, '', `/editor?id=${current.id}`);
    await loadList();
    renderEditor();
    toast('Đã lưu');
  } catch (err) {
    showErrors(err.list || ['Không lưu được, hãy kiểm tra kết nối']);
  } finally {
    $('#save').disabled = false;
  }
}

$('#save').addEventListener('click', save);
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});

$('#delete').addEventListener('click', async () => {
  if (!current?.id || !confirm(`Xoá bộ "${current.title}"? Không thể hoàn tác.`)) return;
  try {
    await api('DELETE', `/api/quizzes/${current.id}`);
  } catch (err) {
    alert(err.list.join('\n'));
    return;
  }
  current = null;
  dirty = false;
  history.replaceState(null, '', '/editor');
  await loadList();
  renderEditor();
  toast('Đã xoá');
});

$('#new-quiz').addEventListener('click', newQuiz);
$('#logout').addEventListener('click', () => {
  if (confirmDiscard()) logout();
});

addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

(async () => {
  try {
    await loadList();
  } catch {
    $('#empty').textContent = 'Không tải được danh sách bộ câu hỏi. Server có đang chạy không?';
    return;
  }
  const id = new URLSearchParams(location.search).get('id') || quizzes[0]?.id;
  if (id) await openQuiz(id);
  else renderEditor();
})();
