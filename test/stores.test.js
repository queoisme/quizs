'use strict';
/*
 * Cùng một bộ test cho mọi cách lưu. Test PostgreSQL chỉ chạy khi có TEST_DATABASE_URL, ví dụ:
 *   TEST_DATABASE_URL=postgres://localhost:5434/quiztest npm test
 * (Database này sẽ bị xoá sạch dữ liệu câu hỏi.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileStore } = require('../src/stores/fileStore');

const sample = (title = 'Bộ thử', n = 2) => ({
  title,
  questions: Array.from({ length: n }, (_, i) => ({
    question: `Câu ${i + 1}?`, answers: ['A', 'B', 'C', 'D'].map((x) => `${x}${i}`), correct: i % 4, time: 10 + i,
  })),
});

function contract(name, makeStore, cleanup) {
  test(`${name}: tạo, đọc, sửa, xoá bộ câu hỏi`, async (t) => {
    const store = await makeStore();
    t.after(() => cleanup(store));

    const created = await store.createQuiz(sample('Bộ A', 3));
    assert.match(created.id, /^[a-f0-9]{12}$/);
    assert.equal(created.questions.length, 3);

    const read = await store.readQuiz(created.id);
    assert.equal(read.title, 'Bộ A');
    assert.deepEqual(read.questions, sample('Bộ A', 3).questions);
    assert.ok(!Number.isNaN(Date.parse(read.createdAt)));

    // Sửa: đổi tên, đổi thứ tự, bớt câu
    const edited = sample('Bộ A (sửa)', 3);
    edited.questions.reverse();
    edited.questions.pop();
    const updated = await store.updateQuiz(created.id, edited);
    assert.equal(updated.title, 'Bộ A (sửa)');
    assert.equal(updated.createdAt, read.createdAt);
    assert.deepEqual((await store.readQuiz(created.id)).questions, edited.questions);

    assert.equal(await store.deleteQuiz(created.id), true);
    assert.equal(await store.readQuiz(created.id), null);
    assert.equal(await store.deleteQuiz(created.id), false);
  });

  test(`${name}: danh sách sắp xếp theo lần sửa mới nhất, có số câu`, async (t) => {
    const store = await makeStore();
    t.after(() => cleanup(store));
    const a = await store.createQuiz(sample('Cũ', 1));
    await new Promise((r) => setTimeout(r, 15));
    await store.createQuiz(sample('Mới', 4));
    await new Promise((r) => setTimeout(r, 15));
    await store.updateQuiz(a.id, sample('Cũ nhưng vừa sửa', 2));

    const list = await store.listQuizzes();
    assert.deepEqual(list.map((q) => [q.title, q.count]), [['Cũ nhưng vừa sửa', 2], ['Mới', 4]]);
  });

  test(`${name}: id lạ hoặc không tồn tại thì trả về null/false, không lỗi`, async (t) => {
    const store = await makeStore();
    t.after(() => cleanup(store));
    assert.equal(await store.readQuiz('../../etc/passwd'), null);
    assert.equal(await store.readQuiz('000000000000'), null);
    assert.equal(await store.updateQuiz('000000000000', sample()), null);
    assert.equal(await store.deleteQuiz('nope'), false);
  });

  test(`${name}: import giữ nguyên id và ghi đè khi chạy lại`, async (t) => {
    const store = await makeStore();
    t.after(() => cleanup(store));
    const quiz = { id: 'abcabcabcabc', ...sample('Import', 2), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
    await store.importQuiz(quiz);
    await store.importQuiz({ ...quiz, title: 'Import lần 2' });
    const read = await store.readQuiz('abcabcabcabc');
    assert.equal(read.title, 'Import lần 2');
    assert.equal(read.createdAt, '2026-01-01T00:00:00.000Z');
    assert.equal((await store.listQuizzes()).length, 1);
  });
}

contract(
  'file',
  async () => {
    const store = createFileStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-')) });
    await store.init();
    return store;
  },
  async () => {},
);

const PG_URL = process.env.TEST_DATABASE_URL;
if (PG_URL) {
  const { createPgStore } = require('../src/stores/pgStore');
  contract(
    'postgres',
    async () => {
      const store = createPgStore({ connectionString: PG_URL });
      await store.init();
      // Mỗi test bắt đầu từ database trống
      const { Client } = require('pg');
      const c = new Client({ connectionString: PG_URL });
      await c.connect();
      await c.query('TRUNCATE quizzes CASCADE');
      await c.end();
      return store;
    },
    (store) => store.close(),
  );
} else {
  test('postgres: bỏ qua (chưa đặt TEST_DATABASE_URL)', { skip: true }, () => {});
}
