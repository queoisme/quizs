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
  t.mock.timers.tick(REVEAL_MS); // sang câu 2
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
  t.mock.timers.tick(REVEAL_MS);
  assert.equal(room.state, 'ended');

  room.leave(a.id, a.socketId); // reload: socket cũ ngắt
  assert.equal(room.join({ name: 'An', socketId: 'x' }).error, 'Ván chơi đã kết thúc'); // không có token
  const res = room.join({ name: 'An', token: a.token, socketId: 'reload' });
  assert.equal(res.ok, true);
  const snap = room.snapshot();
  assert.equal(snap.phase, 'ended');
  assert.equal(snap.leaderboard[0].name, 'An');
});
