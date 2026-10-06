'use strict';
/*
 * Logic của một phòng chơi. Không phụ thuộc Socket.IO: mọi thứ gửi ra ngoài
 * đều đi qua hàm broadcast(event, payload) được truyền vào.
 */
const crypto = require('crypto');
const C = require('../config');
const { generateHazards, DIFFICULTIES } = require('./hazards');

const zoneOf = (x) => Math.max(0, Math.min(C.ZONES - 1, Math.floor(x / (C.WORLD_W / C.ZONES))));
const spawnX = () => Math.round(C.WORLD_W / 2 + (Math.random() * 120 - 60));

function cleanName(raw) {
  // eslint-disable-next-line no-control-regex
  return String(raw || '').replace(/[\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ').slice(0, C.MAX_NAME);
}

class Room {
  /**
   * @param {object} opts
   * @param {string} opts.pin
   * @param {string} opts.hostId socket id của host
   * @param {{id: string, title: string, questions: object[]}} opts.quiz
   * @param {(event: string, payload: any) => void} opts.broadcast gửi tới mọi người trong phòng
   * @param {string} [opts.difficulty] mức thử thách: off | easy | medium | hard
   */
  constructor({ pin, hostId, quiz, broadcast, difficulty = 'medium' }) {
    this.pin = pin;
    this.difficulty = DIFFICULTIES.includes(difficulty) ? difficulty : 'medium';
    this.hostId = hostId;
    this.broadcast = broadcast;
    this.setQuiz(quiz);
    this.players = new Map(); // id -> player
    this.nextId = 1;
    this.state = 'lobby'; // lobby | question | reveal | standings | ended
    this.qIndex = 0;
    this.qStart = 0;
    this.duration = 0;
    this.deadline = 0;
    this.timer = null;
    this.timerFn = null; // việc sẽ làm khi hết giờ (để tạm dừng / tiếp tục)
    this.timerDue = 0;
    this.paused = false;
    this.pausedAt = 0;
    this.pauseLeft = 0;
    this.dirty = false;
    this.lastReveal = null;
    this.lastStandings = null;
    this.prevRanks = new Map(); // id -> hạng ở bảng xếp hạng lần trước, để hiện ▲▼
    this.hazards = [];
    this.takenShields = new Set();
    // Do sockets.js gán: khoá để host nhận lại phòng, link + QR tham gia
    this.hostKey = null;
    this.hostGraceTimer = null;
    this.joinUrl = null;
    this.qr = null;
  }

  setQuiz(quiz) {
    this.quizId = quiz.id;
    this.title = quiz.title;
    this.questions = quiz.questions;
  }

  get online() {
    return [...this.players.values()].filter((p) => p.online);
  }

  leaderboard() {
    return [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score, correct: p.correct, online: p.online }))
      .sort((a, b) => b.score - a.score || b.correct - a.correct || a.name.localeCompare(b.name));
  }

  sendRoster() {
    this.broadcast('roster', this.online.map((p) => ({ id: p.id, name: p.name, color: p.color, shield: p.shield })));
  }

  /* Trạng thái hiện tại, gửi cho người vừa vào phòng */
  snapshot() {
    if (this.state === 'question') return this.questionPayload();
    if (this.state === 'reveal') return { ...this.lastReveal, paused: this.paused };
    if (this.state === 'standings') return { ...this.lastStandings, paused: this.paused };
    if (this.state === 'ended') return { phase: 'ended', leaderboard: this.leaderboard() };
    return this.lobbyPayload();
  }

  lobbyPayload() {
    return { phase: 'lobby', title: this.title, difficulty: this.difficulty };
  }

  questionPayload(spawn) {
    const q = this.questions[this.qIndex];
    return {
      phase: 'question',
      index: this.qIndex,
      total: this.questions.length,
      text: q.question,
      answers: q.answers,
      duration: this.duration,
      remaining: this.questionRemaining(),
      hazards: this.hazards,
      paused: this.paused,
      spawn,
    };
  }

  questionRemaining() {
    return Math.max(0, this.deadline - (this.paused ? this.pausedAt : Date.now()));
  }

  // ---------- Người chơi ----------

  /**
   * Người chơi rớt mạng vào lại (có token, hoặc cùng tên khi nhân vật cũ đã offline) thì giữ nguyên điểm.
   * @returns {{ok: false, error: string} | {ok: true, player: object, replacedSocketId?: string}}
   */
  join({ name: rawName, token, socketId }) {
    const name = cleanName(rawName);
    if (!name) return { ok: false, error: 'Hãy nhập tên' };

    const same = [...this.players.values()].find((p) => p.name.toLowerCase() === name.toLowerCase());
    // Ván đã kết thúc: chỉ người chơi cũ (có token) được vào lại để xem bảng xếp hạng
    if (this.state === 'ended' && !(same && token && token === same.token)) {
      return { ok: false, error: 'Ván chơi đã kết thúc' };
    }
    if (same) {
      const reclaim = !same.online || (token && token === same.token);
      if (!reclaim) return { ok: false, error: 'Tên này đã có người dùng' };
      const replacedSocketId = same.socketId !== socketId ? same.socketId : undefined;
      same.socketId = socketId;
      same.online = true;
      this.sendRoster();
      this.dirty = true;
      return { ok: true, player: same, replacedSocketId };
    }

    if (this.online.length >= C.MAX_PLAYERS) return { ok: false, error: 'Phòng đã đầy' };
    const id = this.nextId++;
    const x = spawnX();
    const player = {
      id,
      name,
      color: C.COLORS[(id - 1) % C.COLORS.length],
      token: crypto.randomBytes(12).toString('hex'),
      socketId,
      online: true,
      x,
      qx: x, // vị trí hợp lệ gần nhất trong câu hiện tại
      y: C.GROUND_Y,
      f: 1,
      score: 0,
      correct: 0,
      zone: zoneOf(x),
      enteredAt: null,
      shield: false,
      hitBy: new Set(),
    };
    this.players.set(id, player);
    this.sendRoster();
    this.dirty = true;
    return { ok: true, player };
  }

  /* Bỏ qua nếu nhân vật đã được một kết nối mới nhận lại */
  leave(playerId, socketId) {
    const p = this.players.get(playerId);
    if (!p || p.socketId !== socketId) return;
    if (this.state === 'lobby') this.players.delete(p.id);
    else p.online = false;
    this.sendRoster();
    this.dirty = true;
  }

  move(playerId, socketId, m) {
    const p = this.players.get(playerId);
    if (!p || p.socketId !== socketId || this.paused) return;
    const x = Number(m?.x);
    const y = Number(m?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    p.x = Math.max(0, Math.min(C.WORLD_W, x));
    p.y = Math.max(0, Math.min(C.GROUND_Y, y));
    p.f = m.f < 0 ? -1 : 1;
    this.dirty = true;
    // Chỉ tính thời điểm chọn ô với gói tin của đúng câu hiện tại (bỏ gói cũ còn trên đường truyền).
    // Lần di chuyển đầu tiên cũng tính là "đã chọn", để ai xuất hiện sẵn trong ô đúng vẫn phải hành động.
    if (this.state === 'question' && m.q === this.qIndex) {
      const zone = zoneOf(p.x);
      const moved = Math.abs(p.x - p.qx) >= 1;
      p.qx = p.x;
      if (zone !== p.zone || (moved && p.enteredAt === null)) {
        p.zone = zone;
        p.enteredAt = Date.now();
      }
    }
  }

  // ---------- Thử thách ----------

  /* Hazard của câu hiện tại, chỉ khi gói tin thuộc đúng câu này */
  currentHazard(m, type) {
    if (this.state !== 'question' || this.paused || m?.q !== this.qIndex) return null;
    const h = this.hazards.find((x) => x.id === m.hazardId);
    return h?.type === type ? h : null;
  }

  /* Người chơi báo bị thiên thạch rơi trúng. Server quyết định khiên có đỡ được hay không. */
  hit(playerId, socketId, m) {
    const p = this.players.get(playerId);
    const h = this.currentHazard(m, 'meteor');
    if (!p || p.socketId !== socketId || !h || p.hitBy.has(h.id)) return;
    if (Date.now() < this.qStart + h.at - 500) return; // chưa tới lúc thiên thạch rơi
    p.hitBy.add(h.id);
    const blocked = p.shield;
    p.shield = false;
    this.broadcast('player:hit', { playerId: p.id, hazardId: h.id, blocked });
    if (blocked) this.sendRoster();
  }

  /* Ai báo nhặt trước thì được khiên; mỗi người chỉ giữ một khiên */
  pickup(playerId, socketId, m) {
    const p = this.players.get(playerId);
    const h = this.currentHazard(m, 'shield');
    if (!p || p.socketId !== socketId || !h || p.shield || this.takenShields.has(h.id)) return;
    if (Date.now() < this.qStart + h.at) return;
    this.takenShields.add(h.id);
    p.shield = true;
    this.broadcast('hazard:picked', { hazardId: h.id, playerId: p.id });
    this.sendRoster();
  }

  flushPositions() {
    if (!this.dirty) return;
    this.dirty = false;
    this.broadcast('pos', this.online.map((p) => [p.id, Math.round(p.x), Math.round(p.y), p.f]));
  }

  // ---------- Diễn biến ván chơi ----------

  start() {
    if (this.state !== 'lobby') return { ok: false, error: 'Ván chơi đã bắt đầu' };
    if (this.online.length === 0) return { ok: false, error: 'Chưa có người chơi nào' };
    this.qIndex = 0;
    this.prevRanks = new Map();
    this.startQuestion();
    return { ok: true };
  }

  /* quiz: bản mới nhất đọc lại từ file (null nếu đã bị xoá thì giữ bản cũ) */
  restart(quiz) {
    if (this.state !== 'ended') return { ok: false, error: 'Ván chơi chưa kết thúc' };
    if (quiz) this.setQuiz(quiz);
    for (const p of [...this.players.values()]) {
      if (!p.online) this.players.delete(p.id);
      p.score = 0;
      p.correct = 0;
      p.shield = false;
    }
    this.state = 'lobby';
    this.qIndex = 0;
    this.sendRoster();
    this.broadcast('phase', this.lobbyPayload());
    return { ok: true, total: this.questions.length };
  }

  // ---------- Hẹn giờ có thể tạm dừng ----------

  schedule(fn, ms) {
    clearTimeout(this.timer);
    this.timerFn = fn;
    this.timerDue = Date.now() + ms;
    this.timer = setTimeout(fn, ms);
  }

  clearSchedule() {
    clearTimeout(this.timer);
    this.timer = null;
    this.timerFn = null;
    this.paused = false;
  }

  get playing() {
    return this.state === 'question' || this.state === 'reveal' || this.state === 'standings';
  }

  pause() {
    if (!this.playing) return { ok: false, error: 'Chỉ tạm dừng được khi đang chơi' };
    if (!this.paused) {
      clearTimeout(this.timer);
      this.paused = true;
      this.pausedAt = Date.now();
      this.pauseLeft = Math.max(0, this.timerDue - this.pausedAt);
      this.broadcast('pause', this.pausePayload());
    }
    return { ok: true };
  }

  resume() {
    if (!this.playing) return { ok: false, error: 'Ván chơi không còn diễn ra' };
    if (this.paused) {
      const delta = Date.now() - this.pausedAt;
      this.paused = false;
      if (this.state === 'question') {
        // Thời gian tạm dừng không tính vào thời gian trả lời (điểm thưởng tốc độ, lịch thử thách)
        this.qStart += delta;
        this.deadline += delta;
        for (const p of this.players.values()) if (p.enteredAt) p.enteredAt += delta;
      }
      this.schedule(this.timerFn, this.pauseLeft);
      this.broadcast('pause', this.pausePayload());
    }
    return { ok: true };
  }

  pausePayload() {
    const payload = { paused: this.paused, state: this.state };
    if (this.state === 'question') Object.assign(payload, { remaining: this.questionRemaining(), duration: this.duration });
    return payload;
  }

  /* Bỏ qua phần đang diễn ra: câu hỏi → hiện đáp án ngay; đáp án/bảng xếp hạng → sang bước tiếp */
  skip() {
    if (!this.playing) return { ok: false, error: 'Ván chơi không còn diễn ra' };
    const state = this.state;
    this.clearSchedule();
    if (state === 'question') this.reveal();
    else if (state === 'reveal') this.afterReveal();
    else this.afterStandings();
    return { ok: true };
  }

  /* Kết thúc ngay; câu đang dở không được tính điểm */
  endEarly() {
    if (!this.playing) return { ok: false, error: 'Ván chơi không còn diễn ra' };
    this.clearSchedule();
    this.endGame();
    return { ok: true };
  }

  // ---------- Diễn biến ván chơi ----------

  startQuestion() {
    const q = this.questions[this.qIndex];
    this.state = 'question';
    this.duration = q.time * 1000;
    this.qStart = Date.now();
    this.deadline = this.qStart + this.duration;
    this.hazards = generateHazards(this.duration, this.difficulty);
    this.takenShields = new Set();

    // Đưa mọi người về giữa sân để không ai được "đứng sẵn" ở ô đáp án
    const spawn = {};
    for (const p of this.players.values()) {
      p.x = spawnX();
      p.qx = p.x;
      p.y = C.GROUND_Y;
      p.zone = zoneOf(p.x);
      p.enteredAt = null;
      p.hitBy = new Set();
      spawn[p.id] = p.x;
    }
    this.dirty = true;
    this.broadcast('phase', this.questionPayload(spawn));
    this.schedule(() => this.reveal(), this.duration);
  }

  reveal() {
    const q = this.questions[this.qIndex];
    this.state = 'reveal';
    const results = {};
    let right = 0;
    for (const p of this.online) {
      const zone = zoneOf(p.x);
      const isRight = zone === q.correct;
      let gained = 0;
      if (isRight) {
        // Vào ô càng sớm càng nhiều điểm thưởng; không di chuyển thì chỉ được điểm cơ bản
        const early = p.enteredAt ? 1 - (p.enteredAt - this.qStart) / this.duration : 0;
        gained = Math.round(C.BASE_POINTS + C.SPEED_BONUS * Math.max(0, Math.min(1, early)));
        p.correct += 1;
        right += 1;
      }
      p.score += gained;
      results[p.id] = { zone, correct: isRight, gained, score: p.score };
    }
    this.lastReveal = {
      phase: 'reveal',
      index: this.qIndex,
      total: this.questions.length,
      text: q.question,
      answers: q.answers,
      correct: q.correct,
      results,
      stats: { right, total: Object.keys(results).length },
      isLast: this.qIndex === this.questions.length - 1,
    };
    this.broadcast('phase', this.lastReveal);
    this.schedule(() => this.afterReveal(), C.REVEAL_MS);
  }

  afterReveal() {
    // Câu cuối thì đi thẳng tới màn công bố kết quả
    if (this.qIndex >= this.questions.length - 1) this.endGame();
    else this.showStandings();
  }

  /* Bảng xếp hạng tạm thời giữa các câu, kèm hạng lần trước để hiện ▲▼ */
  showStandings() {
    this.state = 'standings';
    const results = this.lastReveal?.results || {};
    const board = this.leaderboard();
    let rank = 0;
    const list = board.map((p, i) => {
      if (i === 0 || board[i - 1].score !== p.score) rank = i + 1; // bằng điểm thì đồng hạng
      return { ...p, rank, prevRank: this.prevRanks.get(p.id) ?? null, gained: results[p.id]?.gained ?? 0 };
    });
    this.prevRanks = new Map(list.map((p) => [p.id, p.rank]));
    this.lastStandings = { phase: 'standings', index: this.qIndex, total: this.questions.length, list };
    this.broadcast('phase', this.lastStandings);
    this.schedule(() => this.afterStandings(), C.STANDINGS_MS);
  }

  afterStandings() {
    this.qIndex += 1;
    this.startQuestion();
  }

  endGame() {
    this.state = 'ended';
    this.paused = false;
    this.broadcast('phase', { phase: 'ended', leaderboard: this.leaderboard() });
  }

  close(reason) {
    clearTimeout(this.timer);
    this.broadcast('room:closed', { reason });
  }
}

module.exports = { Room, zoneOf };
