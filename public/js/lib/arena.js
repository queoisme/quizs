'use strict';
/* Vẽ sân chơi, thẻ đáp án và nhân vật lên canvas */
function wrapLines(c, text, maxW) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const t = line ? `${line} ${word}` : word;
    if (!line || c.measureText(t).width <= maxW) line = t;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

class Arena {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.answers = null;
    this.correct = null;
    this.selfId = null;
    this.players = new Map(); // id -> {name, color, x, y, f, tx, ty, seen}
    this.floats = [];
    this.layoutCache = new Map();
    this.time = 0;
    this.hazards = [];
    this.hazardBase = 0; // performance.now() lúc câu hỏi bắt đầu
    this.picked = new Set(); // id các khiên đã có người nhặt
    this.hitSeen = new Set(); // "người:thiên thạch" đã hiện hiệu ứng
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    document.fonts?.ready.then(() => this.layoutCache.clear());
  }

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.floor(Math.max(0, Math.min(box.width - 16, (box.height - 16) * W / H)));
    const h = Math.floor(w * H / W);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
  }

  setRoster(list) {
    const ids = new Set();
    for (const r of list) {
      ids.add(r.id);
      const p = this.players.get(r.id);
      if (p) Object.assign(p, { name: r.name, color: r.color, shield: !!r.shield });
      else {
        this.players.set(r.id, {
          name: r.name, color: r.color, shield: !!r.shield, stunUntil: 0,
          x: W / 2, y: GROUND, f: 1, tx: W / 2, ty: GROUND, seen: false,
        });
      }
    }
    for (const id of [...this.players.keys()]) if (!ids.has(id)) this.players.delete(id);
  }

  setPositions(list) {
    for (const [id, x, y, f] of list) {
      if (id === this.selfId) continue;
      const p = this.players.get(id);
      if (!p) continue;
      p.tx = x; p.ty = y; p.f = f;
      if (!p.seen || Math.abs(p.x - x) > 200) { p.x = x; p.y = y; p.seen = true; }
    }
  }

  setSelf(x, y, f) {
    const p = this.players.get(this.selfId);
    if (p) Object.assign(p, { x, y, f, tx: x, ty: y, seen: true });
  }

  // ---------- Thử thách ----------

  setHazards(list, base = performance.now()) {
    this.hazards = list || [];
    this.hazardBase = base;
    this.picked = new Set();
    this.hitSeen = new Set();
  }

  hazardTime() {
    return performance.now() - this.hazardBase;
  }

  hasShield(id) {
    return !!this.players.get(id)?.shield;
  }

  /* Hiệu ứng khi ai đó bị thiên thạch rơi trúng (blocked = khiên đã đỡ) */
  onHit(id, hazardId, blocked) {
    const p = this.players.get(id);
    const key = `${id}:${hazardId}`;
    if (!p || this.hitSeen.has(key)) return;
    this.hitSeen.add(key);
    if (blocked) {
      p.shield = false;
      this.floats.push({ x: p.x, y: p.y - 70, t: 0, text: 'Khiên đỡ!', color: '#66d9e8' });
    } else {
      p.stunUntil = performance.now() + STUN_MS;
    }
  }

  showResults(results) {
    for (const [id, r] of Object.entries(results || {})) {
      const p = this.players.get(Number(id));
      if (!p) continue;
      this.floats.push({
        x: p.x, y: p.y - 70, t: 0,
        text: r.correct ? `+${r.gained}` : '✗',
        color: r.correct ? '#3ddc84' : '#ff5d6c',
      });
    }
  }

  update(dt) {
    this.time += dt;
    const k = Math.min(1, dt * 15);
    for (const [id, p] of this.players) {
      if (id === this.selfId) continue;
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
    }
    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter((f) => f.t < 1.8);
  }

  draw() {
    const c = this.ctx;
    const s = this.canvas.width / W;
    c.setTransform(s, 0, 0, s, 0, 0);

    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1a1f3d');
    sky.addColorStop(1, '#2c3470');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);

    for (let i = 0; i < 4; i++) this.drawZone(i);

    c.setLineDash([10, 10]);
    c.strokeStyle = 'rgba(255,255,255,.25)';
    c.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      c.beginPath();
      c.moveTo(i * ZONE_W, 170);
      c.lineTo(i * ZONE_W, GROUND);
      c.stroke();
    }
    c.setLineDash([]);

    const t = this.hazardTime();
    this.drawGroundHazards(t);

    const self = this.players.get(this.selfId);
    for (const [id, p] of this.players) if (id !== this.selfId) this.drawPlayer(p, false);
    if (self) this.drawPlayer(self, true);

    this.drawSkyHazards(t);

    for (const f of this.floats) {
      c.globalAlpha = Math.max(0, 1 - f.t / 1.8);
      c.font = `800 26px ${FONT}`;
      c.textAlign = 'center';
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(0,0,0,.6)';
      c.strokeText(f.text, f.x, f.y - f.t * 40);
      c.fillStyle = f.color;
      c.fillText(f.text, f.x, f.y - f.t * 40);
    }
    c.globalAlpha = 1;
  }

  drawZone(i) {
    const c = this.ctx;
    const x = i * ZONE_W;
    const color = ZONE_COLORS[i];
    const revealed = this.correct != null;
    const isRight = this.correct === i;
    const dim = revealed && !isRight;

    // cột màu phía trên ô
    c.globalAlpha = revealed ? (isRight ? 0.32 : 0.05) : 0.13;
    c.fillStyle = color;
    c.fillRect(x, 0, ZONE_W, GROUND);

    // sàn
    c.globalAlpha = dim ? 0.35 : 1;
    c.fillRect(x, GROUND, ZONE_W, H - GROUND);
    c.fillStyle = 'rgba(255,255,255,.3)';
    c.fillRect(x, GROUND, ZONE_W, 4);
    c.fillStyle = '#fff';
    c.font = `800 42px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(LETTERS[i], x + ZONE_W / 2, GROUND + (H - GROUND) / 2 + 3);

    // thẻ đáp án
    const cx = x + 10, cy = 12, cw = ZONE_W - 20, ch = 150;
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(cx, cy, cw, ch, 14);
    c.fill();
    if (isRight) {
      c.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 6);
      c.lineWidth = 5;
      c.strokeStyle = '#fff';
      c.stroke();
      c.globalAlpha = 1;
    }

    c.fillStyle = 'rgba(0,0,0,.25)';
    c.beginPath();
    c.roundRect(cx + 8, cy + 8, 28, 28, 8);
    c.fill();
    c.fillStyle = '#fff';
    c.font = `800 20px ${FONT}`;
    c.fillText(LETTERS[i], cx + 22, cy + 23);

    const text = this.answers ? this.answers[i] : '?';
    const layout = this.layoutText(text, cw - 20, ch - 48);
    c.font = `700 ${layout.size}px ${FONT}`;
    const lh = layout.size * 1.18;
    const top = cy + 42 + (ch - 48 - layout.lines.length * lh) / 2 + lh / 2;
    layout.lines.forEach((line, n) => c.fillText(line, x + ZONE_W / 2, top + n * lh));

    c.globalAlpha = 1;
    c.textBaseline = 'alphabetic';
  }

  layoutText(text, maxW, maxH) {
    const key = `${maxW}|${maxH}|${text}`;
    let layout = this.layoutCache.get(key);
    if (layout) return layout;
    const c = this.ctx;
    for (let size = 28; size >= 12; size -= 2) {
      c.font = `700 ${size}px ${FONT}`;
      const lines = wrapLines(c, text, maxW);
      layout = { size, lines };
      if (lines.length * size * 1.18 <= maxH) break;
    }
    const maxLines = Math.floor(maxH / (layout.size * 1.18));
    if (layout.lines.length > maxLines) {
      layout.lines = layout.lines.slice(0, maxLines);
      layout.lines[maxLines - 1] += '…';
    }
    this.layoutCache.set(key, layout);
    return layout;
  }

  /* Băng, vệt cảnh báo thiên thạch, khiên, gió: vẽ phía sau nhân vật */
  drawGroundHazards(t) {
    const c = this.ctx;
    for (const h of this.hazards) {
      if (h.type === 'ice' && t >= h.at - h.warn && t < h.at + h.dur) {
        const x = h.zone * ZONE_W;
        const fade = Math.min(1, (t - h.at + h.warn) / h.warn, (h.at + h.dur - t) / 400);
        const active = t >= h.at;
        c.globalAlpha = fade * (active ? 0.85 : 0.35 + 0.25 * Math.sin(t / 60));
        const ice = c.createLinearGradient(0, GROUND - 40, 0, H);
        ice.addColorStop(0, 'rgba(200,240,255,0)');
        ice.addColorStop(0.35, 'rgba(190,235,255,.75)');
        ice.addColorStop(1, '#a5e3ff');
        c.fillStyle = ice;
        c.fillRect(x, GROUND - 40, ZONE_W, H - GROUND + 40);
        if (active) {
          c.strokeStyle = 'rgba(255,255,255,.8)';
          c.lineWidth = 2;
          for (let i = 0; i < 6; i++) {
            const sx = x + 20 + ((i * 37 + Math.floor(t / 300) * 13) % (ZONE_W - 40));
            c.beginPath();
            c.moveTo(sx - 5, GROUND + 14 + (i % 3) * 16);
            c.lineTo(sx + 5, GROUND + 14 + (i % 3) * 16);
            c.stroke();
          }
          c.fillStyle = '#e7f8ff';
          c.font = `800 18px ${FONT}`;
          c.textAlign = 'center';
          c.fillText('🧊 TRƠN', x + ZONE_W / 2, GROUND - 14);
        }
        c.globalAlpha = 1;
      }

      if (h.type === 'meteor' && t >= h.at - h.warn && t < h.at) {
        const k = 1 - (h.at - t) / h.warn; // 0 → 1 khi sắp chạm đất
        c.globalAlpha = 0.35 + 0.45 * k + 0.2 * Math.sin(t / (60 - 35 * k));
        c.fillStyle = '#ff3b3b';
        c.beginPath();
        c.ellipse(h.x, GROUND + 3, METEOR_HIT_X * (0.6 + 0.4 * k), 9, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
      }

      if (h.type === 'shield' && !this.picked.has(h.id)) {
        const pos = shieldPos(h, t);
        if (pos) this.drawShieldItem(pos.x, pos.y + Math.sin(t / 200) * (pos.landed ? 3 : 0));
      }

      if (h.type === 'wind' && t >= h.at && t < h.at + h.dur) {
        c.strokeStyle = 'rgba(220,235,255,.45)';
        c.lineWidth = 3;
        c.lineCap = 'round';
        for (let i = 0; i < 14; i++) {
          const len = 60 + (i % 4) * 25;
          const y = 190 + ((i * 53) % (GROUND - 200));
          const speed = 0.6 + (i % 5) * 0.15;
          let x = ((t * speed + i * 211) % (W + len)) - len;
          if (h.dir < 0) x = W - x;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x - h.dir * len, y);
          c.stroke();
        }
        c.lineCap = 'butt';
      }
    }
  }

  /* Thiên thạch đang rơi, vụ nổ, cảnh báo gió: vẽ phía trước nhân vật */
  drawSkyHazards(t) {
    const c = this.ctx;
    for (const h of this.hazards) {
      if (h.type === 'meteor') {
        const pos = meteorPos(h, t);
        if (pos) {
          const trail = c.createLinearGradient(pos.x, pos.y, pos.x - METEOR_SLANT * 0.6, pos.y - 140);
          trail.addColorStop(0, 'rgba(255,170,60,.9)');
          trail.addColorStop(1, 'rgba(255,80,40,0)');
          c.fillStyle = trail;
          c.beginPath();
          c.moveTo(pos.x - 12, pos.y + 8);
          c.lineTo(pos.x - METEOR_SLANT * 0.6, pos.y - 140);
          c.lineTo(pos.x + 12, pos.y - 8);
          c.closePath();
          c.fill();
          const rock = c.createRadialGradient(pos.x - 4, pos.y - 4, 2, pos.x, pos.y, 17);
          rock.addColorStop(0, '#ffe08a');
          rock.addColorStop(0.5, '#ff7b2e');
          rock.addColorStop(1, '#8a2b10');
          c.fillStyle = rock;
          c.beginPath();
          c.arc(pos.x, pos.y, 17, 0, Math.PI * 2);
          c.fill();
        }
        const te = t - h.at;
        if (te >= 0 && te < 450) {
          const k = te / 450;
          c.globalAlpha = 1 - k;
          c.fillStyle = '#ffb347';
          c.beginPath();
          c.arc(h.x, GROUND - 6, 20 + 40 * k, Math.PI, 0);
          c.fill();
          c.strokeStyle = '#fff3c4';
          c.lineWidth = 4;
          c.beginPath();
          c.arc(h.x, GROUND - 6, 30 + 60 * k, Math.PI, 0);
          c.stroke();
          c.globalAlpha = 1;
        }
      }

      if (h.type === 'wind' && t >= h.at - h.warn && t < h.at + h.dur) {
        const warning = t < h.at;
        c.globalAlpha = warning ? 0.5 + 0.5 * Math.abs(Math.sin(t / 120)) : 0.9;
        c.font = `800 30px ${FONT}`;
        c.textAlign = 'center';
        c.lineWidth = 5;
        c.strokeStyle = 'rgba(0,0,0,.6)';
        const text = h.dir > 0 ? '🌬️ GIÓ ➜➜' : '⬅⬅ GIÓ 🌬️';
        c.strokeText(text, W / 2, 205);
        c.fillStyle = '#dff1ff';
        c.fillText(text, W / 2, 205);
        c.globalAlpha = 1;
      }
    }
  }

  drawShieldItem(x, y) {
    const c = this.ctx;
    c.fillStyle = 'rgba(102,217,232,.3)';
    c.beginPath();
    c.arc(x, y, 22 + Math.sin(this.time * 6) * 3, 0, Math.PI * 2);
    c.fill();
    this.shieldPath(x, y, 14);
    c.fillStyle = '#66d9e8';
    c.fill();
    c.strokeStyle = '#fff';
    c.lineWidth = 2.5;
    c.stroke();
  }

  shieldPath(x, y, r) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x, y - r);
    c.quadraticCurveTo(x + r, y - r, x + r, y - r * 0.6);
    c.quadraticCurveTo(x + r * 0.9, y + r * 0.6, x, y + r * 1.1);
    c.quadraticCurveTo(x - r * 0.9, y + r * 0.6, x - r, y - r * 0.6);
    c.quadraticCurveTo(x - r, y - r, x, y - r);
    c.closePath();
  }

  drawPlayer(p, isSelf) {
    const c = this.ctx;
    const { x, y, f } = p;

    // bóng dưới đất, nhỏ dần khi nhảy cao
    const k = Math.max(0.35, 1 - (GROUND - y) / 220);
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.beginPath();
    c.ellipse(x, GROUND + 2, 17 * k, 5 * k, 0, 0, Math.PI * 2);
    c.fill();

    // thân
    c.fillStyle = p.color;
    c.strokeStyle = 'rgba(0,0,0,.4)';
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(x - 17, y - 42, 34, 40, 13);
    c.fill();
    c.stroke();

    // chân
    c.fillStyle = 'rgba(0,0,0,.45)';
    c.beginPath();
    c.ellipse(x - 8, y - 2, 6, 3.5, 0, 0, Math.PI * 2);
    c.ellipse(x + 8, y - 2, 6, 3.5, 0, 0, Math.PI * 2);
    c.fill();

    // mắt nhìn theo hướng di chuyển
    for (const dx of [-6, 6]) {
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(x + f * 4 + dx, y - 29, 5.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#111';
      c.beginPath();
      c.arc(x + f * 6 + dx, y - 29, 2.6, 0, Math.PI * 2);
      c.fill();
    }

    if (p.shield) {
      c.strokeStyle = `rgba(102,217,232,${0.6 + 0.3 * Math.sin(this.time * 5)})`;
      c.fillStyle = 'rgba(102,217,232,.15)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(x, y - 22, 30, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }

    if (p.stunUntil > performance.now()) {
      c.fillStyle = '#ffe066';
      c.font = `800 14px ${FONT}`;
      c.textAlign = 'center';
      for (let i = 0; i < 3; i++) {
        const a = this.time * 6 + (i * Math.PI * 2) / 3;
        c.fillText('★', x + Math.cos(a) * 18, y - 66 + Math.sin(a) * 5);
      }
    }

    // tên
    c.font = `700 15px ${FONT}`;
    c.textAlign = 'center';
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(0,0,0,.7)';
    c.strokeText(p.name, x, y - 50);
    c.fillStyle = isSelf ? '#ffe066' : '#fff';
    c.fillText(p.name, x, y - 50);

    if (isSelf) {
      const by = y - 74 + Math.sin(this.time * 5) * 3;
      c.fillStyle = '#ffe066';
      c.beginPath();
      c.moveTo(x - 8, by - 8);
      c.lineTo(x + 8, by - 8);
      c.lineTo(x, by);
      c.closePath();
      c.fill();
    }
  }
}
