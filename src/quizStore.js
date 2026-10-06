'use strict';
/*
 * Kho bộ câu hỏi. Chọn cách lưu theo biến STORAGE:
 *   file     — file JSON trong QUIZ_DIR (mặc định, để dev)
 *   postgres — PostgreSQL / Amazon RDS (DATABASE_URL, DATABASE_SSL_CA)
 * Mọi kho có cùng các hàm: init, close, listQuizzes, readQuiz, createQuiz, updateQuiz, deleteQuiz, importQuiz
 */
const fs = require('fs');
const C = require('./config');
const { createFileStore } = require('./stores/fileStore');

function createStore() {
  if (C.STORAGE === 'file') return createFileStore({ dir: C.QUIZ_DIR });
  if (C.STORAGE === 'postgres') {
    if (!C.DATABASE_URL) throw new Error('STORAGE=postgres nhưng chưa đặt DATABASE_URL');
    const { createPgStore } = require('./stores/pgStore');
    return createPgStore({
      connectionString: C.DATABASE_URL,
      sslCa: C.DATABASE_SSL_CA ? fs.readFileSync(C.DATABASE_SSL_CA, 'utf8') : undefined,
    });
  }
  throw new Error(`STORAGE không hợp lệ: "${C.STORAGE}" (chỉ nhận file hoặc postgres)`);
}

/* Kiểm tra dữ liệu gửi lên từ trang soạn câu hỏi; trả về lỗi bằng tiếng Việt cho người dùng */
function validateQuiz(body) {
  const errors = [];
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) errors.push('Thiếu tên bộ câu hỏi');
  else if (title.length > 100) errors.push('Tên bộ câu hỏi tối đa 100 ký tự');

  const list = Array.isArray(body?.questions) ? body.questions : [];
  if (list.length === 0) errors.push('Cần ít nhất 1 câu hỏi');
  if (list.length > 100) errors.push('Tối đa 100 câu hỏi mỗi bộ');

  const questions = list.slice(0, 100).map((q, i) => {
    const n = i + 1;
    const text = typeof q?.question === 'string' ? q.question.trim() : '';
    if (!text) errors.push(`Câu ${n}: chưa nhập nội dung câu hỏi`);
    else if (text.length > 300) errors.push(`Câu ${n}: nội dung tối đa 300 ký tự`);

    let answers = [];
    if (!Array.isArray(q?.answers) || q.answers.length !== 4) {
      errors.push(`Câu ${n}: cần đúng 4 đáp án`);
    } else {
      answers = q.answers.map((a) => (typeof a === 'string' ? a.trim() : ''));
      answers.forEach((a, j) => {
        if (!a) errors.push(`Câu ${n}: đáp án ${'ABCD'[j]} đang trống`);
        else if (a.length > 120) errors.push(`Câu ${n}: đáp án ${'ABCD'[j]} tối đa 120 ký tự`);
      });
    }

    const correct = q?.correct;
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) {
      errors.push(`Câu ${n}: chưa chọn đáp án đúng`);
    }
    const time = Number(q?.time);
    if (!Number.isInteger(time) || time < 5 || time > 120) {
      errors.push(`Câu ${n}: thời gian phải là số nguyên từ 5 đến 120 giây`);
    }
    return { question: text, answers, correct, time };
  });

  return { errors, data: { title, questions } };
}

const store = createStore();

module.exports = { validateQuiz, store };
