'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const C = require('./src/config');
const { store } = require('./src/quizStore');
const { createAuth, safeNext } = require('./src/auth');
const quizRoutes = require('./src/routes/quizzes');
const { registerSockets } = require('./src/game/sockets');
const { lanAddress } = require('./src/utils/network');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const auth = createAuth({ password: C.ADMIN_PASSWORD, secret: C.SESSION_SECRET });
const page = (file) => (req, res) => res.sendFile(path.join(C.PUBLIC_DIR, file));

// Chạy sau Caddy/nginx trên cùng máy: tin header X-Forwarded-* để biết request là HTTPS (cookie Secure)
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));

// Trang quản trị: đăng ký trước express.static để /host.html, /editor.html cũng phải đăng nhập
app.get(['/host', '/host.html'], auth.requirePage, page('host.html'));
app.get(['/editor', '/editor.html'], auth.requirePage, page('editor.html'));
app.get(['/login', '/login.html'], (req, res, next) => {
  if (auth.isAdmin(req.headers.cookie)) return res.redirect(safeNext(req.query.next));
  next();
}, page('login.html'));

app.use(express.static(C.PUBLIC_DIR));
app.use('/api', auth.router);
// Cả đọc lẫn ghi đều cần đăng nhập: nội dung bộ câu hỏi có đáp án đúng
app.use('/api/quizzes', auth.requireApi, quizRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ errors: ['Lỗi server, vui lòng thử lại'] });
});

registerSockets(io, { auth });

async function main() {
  await store.init();
  server.listen(C.PORT, () => {
    const lan = `http://${lanAddress()}:${C.PORT}`;
    console.log(`Server đang chạy (lưu câu hỏi: ${store.name}):`);
    console.log(`  Tổ chức chơi : ${C.PUBLIC_URL || lan}/host`);
    console.log(`  Soạn câu hỏi : ${C.PUBLIC_URL || lan}/editor`);
    console.log(`  Người chơi   : ${C.PUBLIC_URL || lan}`);
    if (!auth.enabled) console.warn('⚠ Chưa đặt ADMIN_PASSWORD: ai cũng vào được trang host và soạn câu hỏi.');
  });
}

main().catch((err) => {
  console.error('Không khởi động được server:', err.message);
  process.exit(1);
});

// systemd gửi SIGTERM khi dừng/khởi động lại dịch vụ: đóng kết nối database gọn gàng
process.on('SIGTERM', () => {
  server.close();
  store.close().finally(() => process.exit(0));
});
