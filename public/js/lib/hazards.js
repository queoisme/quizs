'use strict';
/*
 * Quy tắc thử thách dùng chung cho phần vẽ (arena.js) và phần điều khiển (player.js).
 * t = số ms kể từ lúc câu hỏi bắt đầu. Lịch thử thách do server tạo (src/game/hazards.js).
 */
const METEOR_HIT_X = 42; // khoảng cách ngang tính là trúng
const METEOR_HIT_H = 70; // nhảy cao hơn mức này lúc thiên thạch chạm đất thì né được
const METEOR_SLANT = 140; // thiên thạch rơi chéo từ bên trái
const SHIELD_PICK = 42;
const WIND_SPEED = 170; // bằng ~1/2 tốc độ chạy: chạy ngược gió vẫn đi được nhưng chậm
const KNOCK_VX = 620;
const KNOCK_VY = 420;
const STUN_MS = 1500;

const zoneOfX = (x) => Math.max(0, Math.min(3, Math.floor(x / ZONE_W)));

/* -1, 0 hoặc 1: hướng gió đang thổi */
function windAt(hazards, t) {
  let d = 0;
  for (const h of hazards) if (h.type === 'wind' && t >= h.at && t < h.at + h.dur) d += h.dir;
  return Math.sign(d);
}

function iceAt(hazards, t, x) {
  const zone = zoneOfX(x);
  return hazards.some((h) => h.type === 'ice' && h.zone === zone && t >= h.at && t < h.at + h.dur);
}

/* Vị trí thiên thạch đang rơi, null nếu chưa xuất hiện hoặc đã chạm đất */
function meteorPos(h, t) {
  const k = (t - (h.at - h.fall)) / h.fall;
  if (k < 0 || k > 1) return null;
  return { x: h.x - METEOR_SLANT * (1 - k), y: -40 + (GROUND - 12 + 40) * k };
}

/* Vị trí khiên: rơi từ trên xuống rồi nằm trên sàn đến hết câu */
function shieldPos(h, t) {
  if (t < h.at) return null;
  const k = Math.min(1, (t - h.at) / h.fall);
  return { x: h.x, y: -30 + (GROUND - 24 + 30) * k * k, landed: k >= 1 };
}
