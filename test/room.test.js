'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Room } = require('../src/game/Room');
const { REVEAL_MS } = require('../src/config');

// Ô A: x 0-239, B: 240-479, C: 480-719, D: 720-959
const X = { A: 100, B: 300, C: 600, D: 850 };

const quiz = {
  id: 'abcdefabcdef',
  title: 'Test',
  questions: [
    { question: '1+1?', answers: ['1', '2', '3', '4'], correct: 1, time: 10 },
    { question: '2+2?', answers: ['4', '5', '6', '7'], correct: 0, time: 10 },
  ],
};

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const events = [];
  const room = new Room({ pin: '123456', hostId: 'host', quiz, broadcast: (e, p) => events.push([e, p]) });
  const lastPhase = (name) => events.filter(([e, p]) => e === 'phase' && p.phase === name).at(-1)?.[1];
  return { room, events, lastPhase };
}

const join = (room, name, socketId = name) => room.join({ name, socketId }).player;
const move = (room, p, x, q = room.qIndex) => room.move(p.id, p.socketId, { x, y: 470, f: 1, q });

test('tính điểm: vào sớm được thưởng, đứng yên chỉ được điểm cơ bản, sai được 0', (t) => {
  const { room, lastPhase } = setup(t);
  const fast = join(room, 'Nhanh');
  const slow = join(room, 'Cham');
  const idle = join(room, 'DungYen');
  const wrong = join(room, 'Sai');

  room.start();
  idle.x = X.B; // xuất hiện sẵn ở ô đúng nhưng không di chuyển

  t.mock.timers.tick(1000);
  move(room, fast, X.B);
  move(room, wrong, X.D);
  t.mock.timers.tick(7000);
  move(room, slow, X.B);
  t.mock.timers.tick(2000);

  const { results, stats } = lastPhase('reveal');
  assert.equal(results[fast.id].gained, 950); // vào ô ở giây 1/10
  assert.equal(results[slow.id].gained, 600); // vào ô ở giây 8/10
  assert.equal(results[idle.id].gained, 500);
  assert.equal(results[wrong.id].gained, 0);
  assert.deepEqual(stats, { right: 3, total: 4 });
});

test('bỏ qua gói tin vị trí của câu trước khi tính thời điểm chọn ô', (t) => {
  const { room, lastPhase } = setup(t);
  const p = join(room, 'An');
  room.start();
  move(room, p, X.B, null); // gói cũ đến muộn
  t.mock.timers.tick(5000);
  move(room, p, X.B + 10); // lần di chuyển thật đầu tiên ở giây 5
  t.mock.timers.tick(5000);
  assert.equal(lastPhase('reveal').results[p.id].gained, 750);
});

test('đổi ô thì tính lại thời điểm theo lần vào ô cuối cùng', (t) => {
  const { room, lastPhase } = setup(t);
  const p = join(room, 'An');
  room.start();
  move(room, p, X.B);
  t.mock.timers.tick(2000);
  move(room, p, X.C);
  t.mock.timers.tick(2000);
  move(room, p, X.B);
  t.mock.timers.tick(6000);
  assert.equal(lastPhase('reveal').results[p.id].gained, 800);
});

test('trùng tên bị từ chối, vào lại bằng token thì giữ điểm và báo socket cũ', (t) => {
  const { room } = setup(t);
  const p = join(room, 'An', 'sock1');
  assert.equal(room.join({ name: 'an', socketId: 'sock2' }).error, 'Tên này đã có người dùng');

  room.start();
  p.score = 1234;
  const res = room.join({ name: 'An', token: p.token, socketId: 'sock2' });
  assert.equal(res.ok, true);
  assert.equal(res.player, p);
  assert.equal(res.replacedSocketId, 'sock1');

  // socket cũ ngắt kết nối sau đó không được làm nhân vật offline
  room.leave(p.id, 'sock1');
  assert.equal(p.online, true);
  assert.equal(p.score, 1234);
});

test('rớt mạng giữa ván thì vào lại bằng tên cũ được, trong phòng chờ thì bị xoá', (t) => {
  const { room } = setup(t);
  const a = join(room, 'An');
  const b = join(room, 'Binh');
  room.leave(b.id, b.socketId);
  assert.equal(room.players.has(b.id), false);

  room.start();
  room.leave(a.id, a.socketId);
  assert.equal(a.online, false);
  const res = room.join({ name: 'An', socketId: 'new' });
  assert.equal(res.player, a);
  assert.equal(a.online, true);
});

test('hết câu cuối thì kết thúc và xếp hạng theo điểm; chơi lại thì reset điểm', (t) => {
  const { room, lastPhase } = setup(t);
  const a = join(room, 'An');
  const b = join(room, 'Binh');
  room.start();
  move(room, a, X.B);
  move(room, b, X.C);
  t.mock.timers.tick(10_000); // hết câu 1
  t.mock.timers.tick(REVEAL_MS); // hiện đáp án xong → sang câu 2
  assert.equal(room.qIndex, 1);
  move(room, a, X.A);
  move(room, b, X.A);
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(REVEAL_MS);

  const { leaderboard } = lastPhase('ended');
  assert.deepEqual(leaderboard.map((p) => [p.name, p.correct]), [['An', 2], ['Binh', 1]]);
  assert.equal(room.join({ name: 'Moi', socketId: 'x' }).error, 'Ván chơi đã kết thúc');

  assert.equal(room.restart(null).ok, true);
  assert.equal(room.state, 'lobby');
  assert.equal(a.score, 0);
});

test('ván đã kết thúc: người chơi cũ có token reload vẫn xem được bảng xếp hạng, người lạ thì không', (t) => {
  const { room } = setup(t);
  const a = join(room, 'An');
  room.start();
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(REVEAL_MS);
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(REVEAL_MS); // câu cuối: đi thẳng tới kết thúc
  assert.equal(room.state, 'ended');

  room.leave(a.id, a.socketId); // reload: socket cũ ngắt
  assert.equal(room.join({ name: 'An', socketId: 'x' }).error, 'Ván chơi đã kết thúc'); // không có token
  const res = room.join({ name: 'An', token: a.token, socketId: 'reload' });
  assert.equal(res.ok, true);
  const snap = room.snapshot();
  assert.equal(snap.phase, 'ended');
  assert.equal(snap.leaderboard[0].name, 'An');
});

test('sau mỗi câu: bảng xếp hạng (cho host) có hạng câu trước để hiện ▲▼, mỗi người biết hạng của mình', (t) => {
  const { room, lastPhase } = setup(t);
  const a = join(room, 'An');
  const b = join(room, 'Binh');
  room.start();
  move(room, b, X.B); // câu 1 đúng là B: Bình dẫn đầu
  move(room, a, X.C);
  t.mock.timers.tick(10_000);
  const r1 = lastPhase('reveal');
  assert.deepEqual(r1.standings.map((p) => [p.name, p.rank, p.prevRank]), [['Binh', 1, null], ['An', 2, null]]);
  assert.ok(r1.standings[0].gained > 0);
  assert.equal(r1.standings[1].gained, 0);
  assert.deepEqual([r1.results[a.id].rank, r1.results[b.id].rank, r1.playerCount], [2, 1, 2]);
  assert.equal(room.rankOf(a.id), 2);

  // Câu 2: An đúng còn Bình sai → An vươn lên
  t.mock.timers.tick(REVEAL_MS);
  assert.equal(room.state, 'question'); // không còn màn bảng xếp hạng chen giữa
  a.score += 2000;
  move(room, a, X.A);
  move(room, b, X.D);
  t.mock.timers.tick(10_000);
  const r2 = lastPhase('reveal');
  assert.deepEqual(r2.standings.map((p) => [p.name, p.rank, p.prevRank]), [['An', 1, 2], ['Binh', 2, 1]]);
  assert.equal(r2.results[a.id].rank, 1);
});

test('tạm dừng: đồng hồ đứng yên, không nhận di chuyển, điểm thưởng tốc độ không bị lệch', (t) => {
  const { room, events, lastPhase } = setup(t);
  const p = join(room, 'An');
  room.start();
  t.mock.timers.tick(2000);
  move(room, p, X.B); // vào ô đúng ở giây 2/10

  assert.equal(room.pause().ok, true);
  assert.equal(room.snapshot().paused, true);
  assert.equal(room.snapshot().remaining, 8000);
  move(room, p, X.D); // đang dừng: bỏ qua
  t.mock.timers.tick(60_000); // dừng 1 phút
  assert.equal(room.state, 'question'); // chưa hết giờ
  assert.equal(room.snapshot().remaining, 8000);

  room.resume();
  const resumed = events.filter(([e]) => e === 'pause').map(([, x]) => x);
  assert.deepEqual(resumed.map((x) => x.paused), [true, false]);
  assert.equal(resumed[1].remaining, 8000);

  t.mock.timers.tick(7999);
  assert.equal(room.state, 'question');
  t.mock.timers.tick(1);
  assert.equal(room.state, 'reveal');
  assert.equal(lastPhase('reveal').results[p.id].gained, 900); // như chưa từng tạm dừng
});

test('tạm dừng lúc hiện đáp án cũng giữ nguyên thời gian còn lại', (t) => {
  const { room } = setup(t);
  join(room, 'An');
  room.start();
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(1000);
  room.pause();
  t.mock.timers.tick(30_000);
  assert.equal(room.state, 'reveal');
  room.resume();
  t.mock.timers.tick(REVEAL_MS - 1001);
  assert.equal(room.state, 'reveal');
  t.mock.timers.tick(1);
  assert.equal(room.state, 'question');
});

test('bỏ qua: câu hỏi → đáp án → câu tiếp; kể cả khi đang tạm dừng', (t) => {
  const { room } = setup(t);
  join(room, 'An');
  room.start();
  room.pause();
  assert.equal(room.skip().ok, true);
  assert.equal(room.state, 'reveal');
  assert.equal(room.paused, false);
  room.skip();
  assert.equal(room.state, 'question');
  assert.equal(room.qIndex, 1);
  // timer cũ đã bị huỷ: đợi lâu cũng chỉ đi đúng một bước
  t.mock.timers.tick(10_000);
  assert.equal(room.state, 'reveal');
});

test('kết thúc sớm: nhảy tới bảng xếp hạng cuối, câu đang dở không tính điểm', (t) => {
  const { room, lastPhase } = setup(t);
  const p = join(room, 'An');
  room.start();
  move(room, p, X.B);
  assert.equal(room.endEarly().ok, true);
  assert.equal(room.state, 'ended');
  assert.equal(lastPhase('ended').leaderboard[0].score, 0);
  t.mock.timers.tick(60_000); // không còn timer nào chạy tiếp
  assert.equal(room.state, 'ended');
  assert.equal(room.pause().ok, false);
  assert.equal(room.skip().ok, false);
});

test('bảng xếp hạng sau mỗi câu: bằng điểm thì đồng hạng', (t) => {
  const { room, lastPhase } = setup(t);
  const a = join(room, 'An');
  const b = join(room, 'Binh');
  const c = join(room, 'Chi');
  room.start();
  move(room, a, X.B);
  move(room, b, X.C);
  move(room, c, X.D);
  t.mock.timers.tick(10_000);
  assert.deepEqual(lastPhase('reveal').standings.map((p) => [p.name, p.rank]), [['An', 1], ['Binh', 2], ['Chi', 2]]);
});
