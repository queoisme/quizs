'use strict';
/*
 * Chép các bộ câu hỏi dạng file JSON vào kho đang cấu hình (thường là PostgreSQL trên RDS).
 *   STORAGE=postgres DATABASE_URL=... node scripts/import-quizzes.js [thư-mục]
 * Mặc định đọc data/quizzes. Bộ nào đã có (cùng id) thì ghi đè; chạy lại nhiều lần vẫn an toàn.
 */
const fs = require('fs/promises');
const path = require('path');
const C = require('../src/config');
const { validateQuiz, store } = require('../src/quizStore');
const { ID_RE } = require('../src/stores/ids');

async function main() {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'quizzes'));
  if (C.STORAGE === 'file' && path.resolve(C.QUIZ_DIR) === dir) {
    throw new Error('Đang dùng STORAGE=file với chính thư mục này, không có gì để import. Hãy đặt STORAGE=postgres.');
  }
  await store.init();
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  let ok = 0;
  for (const f of files) {
    const raw = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
    const { errors, data } = validateQuiz(raw);
    if (!ID_RE.test(raw.id) || errors.length) {
      console.warn(`✗ ${f}: ${errors.join('; ') || 'id không hợp lệ'}`);
      continue;
    }
    const now = new Date().toISOString();
    await store.importQuiz({ id: raw.id, ...data, createdAt: raw.createdAt || now, updatedAt: raw.updatedAt || now });
    console.log(`✓ ${data.title} (${data.questions.length} câu)`);
    ok += 1;
  }
  console.log(`Đã import ${ok}/${files.length} bộ câu hỏi vào ${store.name}`);
}

main()
  .catch((err) => {
    console.error('Lỗi:', err.message);
    process.exitCode = 1;
  })
  .finally(() => store.close());
