'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateHazards, START_MS, END_GAP_MS } = require('../src/game/hazards');
const { Room } = require('../src/game/Room');

// Bộ sinh số ngẫu nhiên cố định để kết quả lặp lại được
function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const end = (h) => h.at + (h.dur || 0);

test('tắt thử thách thì không có gì; câu quá ngắn cũng không có', () => {
  assert.deepEqual(generateHazards(15000, 'off'), []);
  assert.deepEqual(generateHazards(3000, 'hard'), []);
});

test('thử thách nằm trong khoảng cho phép và có đủ 4 loại ở mức Vừa', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const list = generateHazards(15000, 'medium', seeded(seed));
    const types = new Set(list.map((h) => h.type));
    assert.deepEqual([...types].sort(), ['ice', 'meteor', 'shield', 'wind']);
    for (const h of list) {
      const start = h.type === 'meteor' ? h.at - h.warn : h.at;
      assert.ok(start >= START_MS, `${h.type} bắt đầu quá sớm: ${start}`);
      assert.ok(end(h) <= 15000 - END_GAP_MS, `${h.type} kết thúc quá muộn: ${end(h)}`);
      if (h.x != null) assert.ok(h.x >= 0 && h.x <= 960);
      if (h.zone != null) assert.ok(h.zone >= 0 && h.zone <= 3);
    }
    assert.equal(new Set(list.map((h) => h.id)).size, list.length);
  }
});

test('mức khó có nhiều thiên thạch hơn mức dễ', () => {
  const meteors = (level) => generateHazards(30000, level, seeded(7)).filter((h) => h.type === 'meteor').length;
  assert.ok(meteors('hard') > meteors('medium'));
  assert.ok(meteors('medium') > meteors('easy'));
});

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const events = [];
  const quiz = { id: 'abcdefabcdef', title: 'T', questions: [{ question: 'q', answers: ['a', 'b', 'c', 'd'], correct: 0, time: 15 }] };
  const room = new Room({ pin: '1', hostId: 'h', quiz, broadcast: (e, p) => events.push([e, p]) });
  const a = room.join({ name: 'An', socketId: 'a' }).player;
  const b = room.join({ name: 'Binh', socketId: 'b' }).player;
  room.start();
  // Lịch cố định để test không phụ thuộc ngẫu nhiên
  room.hazards = [
    { id: 'h0', type: 'shield', at: 2000, x: 300, fall: 1200 },
    { id: 'h1', type: 'meteor', at: 4000, x: 300, warn: 1200, fall: 600 },
    { id: 'h2', type: 'meteor', at: 6000, x: 300, warn: 1200, fall: 600 },
  ];
  const of = (name) => events.filter(([e]) => e === name).map(([, p]) => p);
  return { room, a, b, of };
}

test('khiên: chỉ người nhặt đầu tiên có được, và đỡ được đúng một lần thiên thạch', (t) => {
  const { room, a, b, of } = setup(t);
  room.pickup(a.id, 'a', { hazardId: 'h0', q: 0 }); // chưa rơi xuống thì không nhặt được
  assert.equal(a.shield, false);

  t.mock.timers.tick(3000);
  room.pickup(a.id, 'a', { hazardId: 'h0', q: 0 });
  room.pickup(b.id, 'b', { hazardId: 'h0', q: 0 });
  assert.equal(a.shield, true);
  assert.equal(b.shield, false);
  assert.deepEqual(of('hazard:picked'), [{ hazardId: 'h0', playerId: a.id }]);

  t.mock.timers.tick(1000);
  room.hit(a.id, 'a', { hazardId: 'h1', q: 0 });
  room.hit(a.id, 'a', { hazardId: 'h1', q: 0 }); // báo trùng thì bỏ qua
  t.mock.timers.tick(2000);
  room.hit(a.id, 'a', { hazardId: 'h2', q: 0 });
  assert.deepEqual(of('player:hit').map((h) => h.blocked), [true, false]);
  assert.equal(a.shield, false);
});

test('bỏ qua báo trúng sai loại, sai câu, hoặc trước lúc thiên thạch rơi', (t) => {
  const { room, a, of } = setup(t);
  room.hit(a.id, 'a', { hazardId: 'h1', q: 0 }); // giây 0, thiên thạch rơi lúc giây 4
  t.mock.timers.tick(4000);
  room.hit(a.id, 'a', { hazardId: 'h0', q: 0 }); // h0 là khiên
  room.hit(a.id, 'a', { hazardId: 'h1', q: 5 }); // gói tin của câu khác
  room.hit(a.id, 'x', { hazardId: 'h1', q: 0 }); // socket không phải của An
  assert.equal(of('player:hit').length, 0);
});
