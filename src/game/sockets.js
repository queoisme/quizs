'use strict';
/* Nhận sự kiện Socket.IO rồi chuyển cho Room tương ứng */
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Room } = require('./Room');
const { DIFFICULTY_LABELS } = require('./hazards');
const { store } = require('../quizStore');
const { joinUrl } = require('../utils/network');
const { TICK_MS, HOST_GRACE_MS } = require('../config');

const noop = () => {};

/**
 * @param {import('socket.io').Server} io
 * @param {{auth: {isAdmin: (cookieHeader?: string) => boolean}}} deps
 */
function registerSockets(io, { auth }) {
  const rooms = new Map(); // pin -> Room

  function makePin() {
    let pin;
    do pin = String(crypto.randomInt(100000, 1000000));
    while (rooms.has(pin));
    return pin;
  }

  function closeRoom(room, reason) {
    clearTimeout(room.hostGraceTimer);
    room.close(reason);
    io.in(room.pin).socketsLeave(room.pin);
    rooms.delete(room.pin);
  }

  io.on('connection', (socket) => {
    const myRoom = () => rooms.get(socket.data.pin);
    // Cookie đăng nhập quản trị được gửi kèm khi mở kết nối socket
    const isAdminSocket = () => auth.isAdmin(socket.handshake.headers.cookie);
    const NOT_ADMIN = { ok: false, error: 'Cần đăng nhập quản trị', login: true };
    const isHost = (room) => room && socket.data.role === 'host' && room.hostId === socket.id;
    const hostRoom = (reply) => {
      const room = myRoom();
      if (isHost(room)) return room;
      reply({ ok: false, error: 'Bạn không phải chủ phòng' });
      return null;
    };

    function attachHost(room) {
      clearTimeout(room.hostGraceTimer);
      room.hostId = socket.id;
      socket.join(room.pin);
      socket.data.role = 'host';
      socket.data.pin = room.pin;
    }

    const roomInfo = (room) => ({
      ok: true,
      pin: room.pin,
      hostKey: room.hostKey,
      url: room.joinUrl,
      qr: room.qr,
      title: room.title,
      total: room.questions.length,
      difficulty: DIFFICULTY_LABELS[room.difficulty],
    });

    socket.on('host:create', async (data, ack) => {
      if (typeof ack !== 'function') return;
      try {
        if (socket.data.role === 'player') return ack({ ok: false, error: 'Bạn đang là người chơi' });
        if (!isAdminSocket()) return ack(NOT_ADMIN);
        const quiz = await store.readQuiz(String(data?.quizId || ''));
        if (!quiz) return ack({ ok: false, error: 'Không tìm thấy bộ câu hỏi' });

        const old = myRoom();
        if (isHost(old)) closeRoom(old, 'Chủ phòng đã tạo phòng mới');

        const pin = makePin();
        const room = new Room({
          pin,
          hostId: socket.id,
          quiz,
          difficulty: data?.difficulty,
          broadcast: (event, payload) => io.to(pin).emit(event, payload),
        });
        room.hostKey = crypto.randomBytes(16).toString('hex');
        room.joinUrl = joinUrl(pin);
        room.qr = await QRCode.toDataURL(room.joinUrl, { margin: 1, width: 512 });
        rooms.set(pin, room);
        attachHost(room);
        ack(roomInfo(room));
      } catch (err) {
        console.error(err);
        ack({ ok: false, error: 'Không tạo được phòng' });
      }
    });

    /* Host reload trang hoặc kết nối lại: nhận lại phòng bằng khoá bí mật */
    socket.on('host:resume', (data, ack) => {
      if (typeof ack !== 'function') return;
      if (!isAdminSocket()) return ack(NOT_ADMIN);
      const room = rooms.get(String(data?.pin || ''));
      if (!room || socket.data.role === 'player' || data?.hostKey !== room.hostKey) {
        return ack({ ok: false, error: 'Phòng đã đóng' });
      }
      const oldHost = io.sockets.sockets.get(room.hostId);
      attachHost(room);
      if (oldHost && oldHost.id !== socket.id) oldHost.disconnect(true);
      ack({ ...roomInfo(room), phase: room.snapshot() });
      room.sendRoster();
    });

    /* Host chủ động rời phòng (bấm "Chọn bộ khác") */
    socket.on('host:leave', (_, ack) => {
      const reply = typeof ack === 'function' ? ack : noop;
      const room = hostRoom(reply);
      if (!room) return;
      closeRoom(room, room.state === 'lobby' ? 'Chủ phòng đã huỷ phòng' : 'Chủ phòng đã đóng phòng');
      socket.data.role = undefined;
      socket.data.pin = undefined;
      reply({ ok: true });
    });

    socket.on('host:start', (_, ack) => {
      const reply = typeof ack === 'function' ? ack : noop;
      const room = hostRoom(reply);
      if (room) reply(room.start());
    });

    // Điều khiển trận đấu: tạm dừng, tiếp tục, bỏ qua, kết thúc sớm
    for (const [event, action] of [
      ['host:pause', 'pause'], ['host:resume', 'resume'], ['host:skip', 'skip'], ['host:end', 'endEarly'],
    ]) {
      socket.on(event, (_, ack) => {
        const reply = typeof ack === 'function' ? ack : noop;
        const room = hostRoom(reply);
        if (room) reply(room[action]());
      });
    }

    socket.on('host:restart', async (_, ack) => {
      const reply = typeof ack === 'function' ? ack : noop;
      const room = hostRoom(reply);
      if (!room) return;
      // Đọc lại bộ câu hỏi để áp dụng các chỉnh sửa mới nhất
      const quiz = await store.readQuiz(room.quizId).catch(() => null);
      reply(room.restart(quiz));
    });

    socket.on('player:join', (data, ack) => {
      if (typeof ack !== 'function') return;
      if (socket.data.role) return ack({ ok: false, error: 'Bạn đã ở trong phòng' });

      const pin = String(data?.pin || '').trim();
      const room = rooms.get(pin);
      if (!room) return ack({ ok: false, error: 'Mã PIN không đúng hoặc phòng đã đóng' });

      // Vào phòng trước để nhận được roster mà room.join() phát ra
      socket.join(pin);
      const res = room.join({ name: data?.name, token: data?.token, socketId: socket.id });
      if (!res.ok) {
        socket.leave(pin);
        return ack(res);
      }
      if (res.replacedSocketId) io.sockets.sockets.get(res.replacedSocketId)?.disconnect(true);

      const p = res.player;
      socket.data.role = 'player';
      socket.data.pin = pin;
      socket.data.playerId = p.id;
      ack({
        ok: true, id: p.id, token: p.token, color: p.color, x: p.x, score: p.score,
        rank: room.state === 'lobby' ? null : room.rankOf(p.id), playerCount: room.players.size,
        title: room.title, phase: room.snapshot(),
      });
    });

    socket.on('player:move', (m) => {
      myRoom()?.move(socket.data.playerId, socket.id, m);
    });

    socket.on('player:hit', (m) => {
      myRoom()?.hit(socket.data.playerId, socket.id, m);
    });

    socket.on('player:pickup', (m) => {
      myRoom()?.pickup(socket.data.playerId, socket.id, m);
    });

    socket.on('disconnect', () => {
      const room = myRoom();
      if (!room) return;
      if (isHost(room)) {
        // Chờ host quay lại (reload trang, mạng chập chờn) trước khi đóng phòng
        room.hostGraceTimer = setTimeout(() => {
          if (rooms.get(room.pin) === room) closeRoom(room, 'Chủ phòng đã rời đi');
        }, HOST_GRACE_MS);
      } else if (socket.data.role === 'player') room.leave(socket.data.playerId, socket.id);
    });
  });

  // Gửi vị trí nhân vật cho cả phòng ~20 lần/giây
  setInterval(() => {
    for (const room of rooms.values()) room.flushPositions();
  }, TICK_MS);
}

module.exports = { registerSockets };
