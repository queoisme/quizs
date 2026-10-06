'use strict';
/*
 * Lịch thử thách cho một câu hỏi. Thời gian tính bằng ms kể từ lúc câu hỏi bắt đầu.
 * Server tạo lịch rồi gửi cho mọi máy, nên ai cũng thấy thử thách giống hệt nhau.
 *
 *   meteor  { at: lúc chạm đất, x, warn: thời gian cảnh báo trước, fall: thời gian rơi }
 *   wind    { at: lúc bắt đầu thổi, dur, dir: -1 trái / 1 phải, warn }
 *   ice     { at, dur, zone: ô bị đóng băng 0-3, warn }
 *   shield  { at: lúc bắt đầu rơi, x, fall }
 */
const { WORLD_W, ZONES } = require('../config');

const START_MS = 2000; // không có thử thách trong 2 giây đầu
const END_GAP_MS = 1000; // và 1 giây cuối

const LEVELS = {
  off: null,
  easy: { meteorEvery: 2600, winds: [0, 1], ices: [0, 1], shields: [0, 1] },
  medium: { meteorEvery: 1500, winds: [1, 1], ices: [1, 1], shields: [1, 1] },
  hard: { meteorEvery: 850, winds: [1, 2], ices: [1, 2], shields: [1, 1] },
};
const DIFFICULTIES = Object.keys(LEVELS);
const DIFFICULTY_LABELS = { off: 'Tắt', easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };

function generateHazards(durationMs, level, rand = Math.random) {
  const cfg = LEVELS[level];
  const from = START_MS;
  const to = durationMs - END_GAP_MS;
  if (!cfg || to - from < 500) return [];

  const between = (a, b) => a + rand() * (b - a);
  const count = ([lo, hi]) => lo + Math.floor(rand() * (hi - lo + 1));
  const list = [];

  // Thiên thạch rải đều có dao động; vệt cảnh báo xuất hiện từ sau giây thứ 2
  const meteorWarn = 1200;
  for (let t = from + meteorWarn + rand() * cfg.meteorEvery * 0.5; t <= to; t += cfg.meteorEvery * between(0.7, 1.3)) {
    list.push({ type: 'meteor', at: Math.round(t), x: Math.round(between(30, WORLD_W - 30)), warn: meteorWarn, fall: 600 });
  }

  const windDur = Math.min(3000, to - from);
  for (let i = count(cfg.winds); i > 0; i--) {
    list.push({
      type: 'wind', at: Math.round(between(from, to - windDur)), dur: windDur,
      dir: rand() < 0.5 ? -1 : 1, warn: 1000,
    });
  }

  for (let i = count(cfg.ices); i > 0; i--) {
    const dur = Math.min(Math.round(between(4000, 6000)), to - from);
    list.push({
      type: 'ice', at: Math.round(between(from, to - dur)), dur,
      zone: Math.floor(rand() * ZONES), warn: 800,
    });
  }

  for (let i = count(cfg.shields); i > 0; i--) {
    list.push({
      type: 'shield', at: Math.round(between(from, Math.max(from, to - 2000))),
      x: Math.round(between(40, WORLD_W - 40)), fall: 1200,
    });
  }

  return list.sort((a, b) => a.at - b.at).map((h, i) => ({ id: `h${i}`, ...h }));
}

module.exports = { generateHazards, DIFFICULTIES, DIFFICULTY_LABELS, START_MS, END_GAP_MS };
