'use strict';
const path = require('path');

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  // Đặt PUBLIC_URL khi chạy sau domain/ngrok, ví dụ https://abc.ngrok.app
  PUBLIC_URL: process.env.PUBLIC_URL,
  PUBLIC_DIR: path.join(__dirname, '..', 'public'),

  // Lưu bộ câu hỏi: "file" (mặc định, để dev) hoặc "postgres" (RDS trên AWS)
  STORAGE: process.env.STORAGE || 'file',
  QUIZ_DIR: process.env.QUIZ_DIR || path.join(__dirname, '..', 'data', 'quizzes'),
  DATABASE_URL: process.env.DATABASE_URL,
  // RDS bắt buộc SSL: trỏ tới file chứng chỉ CA của AWS (global-bundle.pem) để xác thực server
  DATABASE_SSL_CA: process.env.DATABASE_SSL_CA,

  // Mật khẩu quản trị cho trang soạn câu hỏi và host. Bỏ trống = không cần đăng nhập (chỉ nên dùng khi dev)
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  // Khoá ký cookie đăng nhập. Bỏ trống thì tạo ngẫu nhiên mỗi lần chạy (khởi động lại = phải đăng nhập lại)
  SESSION_SECRET: process.env.SESSION_SECRET,

  // Kích thước thế giới game — phải khớp với public/js/lib/constants.js
  WORLD_W: 960,
  GROUND_Y: 470,
  ZONES: 4,

  REVEAL_MS: 4000, // hiện đáp án đúng
  HOST_GRACE_MS: 60000, // host mất kết nối/reload: giữ phòng chừng này để host quay lại
  TICK_MS: 50,
  BASE_POINTS: 500,
  SPEED_BONUS: 500,
  MAX_NAME: 16,
  MAX_PLAYERS: 60,
  COLORS: [
    '#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ffa94d',
    '#38d9a9', '#f783ac', '#a9e34b', '#91a7ff', '#ffc078', '#66d9e8',
  ],
};
