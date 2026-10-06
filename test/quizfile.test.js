'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const QF = require('../public/js/lib/quizfile');

const enc = (s) => new TextEncoder().encode(s);

test('CSV: dấu ngoặc kép, dấu phẩy và xuống dòng bên trong ô', () => {
  const rows = QF.parseCsv('a,"b, c","say ""hi""","dòng 1\ndòng 2"\r\nx,y,z,w\n');
  assert.deepEqual(rows, [['a', 'b, c', 'say "hi"', 'dòng 1\ndòng 2'], ['x', 'y', 'z', 'w']]);
});

test('CSV: tự nhận dấu phân cách ; và Tab', () => {
  assert.deepEqual(QF.parseCsv('a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(QF.parseCsv('a\tb, c\n1\t2'), [['a', 'b, c'], ['1', '2']]);
});

test('mã hoá: bỏ BOM UTF-8; file Windows-1258 vẫn đọc đúng tiếng Việt', () => {
  assert.deepEqual(QF.decodeText(enc('\uFEFFCâu hỏi')), { text: 'Câu hỏi', encoding: 'utf-8' });
  // "Câu" trong Windows-1258: C=0x43, â=0xE2, u=0x75
  assert.deepEqual(QF.decodeText(new Uint8Array([0x43, 0xe2, 0x75])), { text: 'Câu', encoding: 'windows-1258' });
  // "Hỏi" trong Windows-1258 là H, o, dấu hỏi rời (0xD2), i → phải ghép lại thành "ỏ"
  const hoi = QF.decodeText(new Uint8Array([0x48, 0x6f, 0xd2, 0x69])).text;
  assert.equal(hoi, 'Hỏi');
  assert.equal(hoi.length, 3);
});

test('nhận tiêu đề cột có dấu, không dấu, tiếng Anh và thứ tự cột bất kỳ', () => {
  for (const header of [
    ['Câu hỏi', 'Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D', 'Đáp án đúng', 'Thời gian (giây)'],
    ['cau hoi', 'dap an a', 'dap an b', 'dap an c', 'dap an d', 'dap an dung', 'thoi gian'],
    ['Question', 'Answer 1', 'Answer 2', 'Answer 3', 'Answer 4', 'Correct answer', 'Time limit'],
  ]) {
    const { rows, hasHeader } = QF.rowsToQuestions([header, ['Q?', 'w', 'x', 'y', 'z', 'C', '20']]);
    assert.equal(hasHeader, true, header.join());
    assert.deepEqual(rows[0].data, { question: 'Q?', answers: ['w', 'x', 'y', 'z'], correct: 2, time: 20 });
  }
  const shuffled = QF.rowsToQuestions([['Đáp án đúng', 'A', 'B', 'C', 'D', 'Câu hỏi'], ['2', 'p', 'q', 'r', 's', 'Đảo cột?']]);
  assert.deepEqual(shuffled.rows[0].data, { question: 'Đảo cột?', answers: ['p', 'q', 'r', 's'], correct: 1, time: 15 });
});

test('không có tiêu đề thì đọc theo thứ tự cột mặc định; bỏ qua dòng trống', () => {
  const { rows, hasHeader } = QF.rowsToQuestions([['Q1', 'a', 'b', 'c', 'd', 'D'], ['', '', ''], ['Q2', 'a', 'b', 'c', 'd', 'a', '30']]);
  assert.equal(hasHeader, false);
  assert.deepEqual(rows.map((r) => [r.line, r.data.correct, r.data.time]), [[1, 3, 15], [3, 0, 30]]);
});

test('đáp án đúng: A–D, 1–4, hoặc gõ đúng nội dung đáp án', () => {
  const answers = ['Hà Nội', 'Huế', 'Đà Nẵng', 'TP.HCM'];
  assert.equal(QF.parseCorrect('b', answers).index, 1);
  assert.equal(QF.parseCorrect(' 4 ', answers).index, 3);
  assert.equal(QF.parseCorrect('ha noi', answers).index, 0);
  assert.match(QF.parseCorrect('E', answers).error, /không hợp lệ/);
  assert.match(QF.parseCorrect('', answers).error, /thiếu/);
});

test('thời gian: trống = 15, nhận "20s"/"20 giây", ngoài 5–120 thì báo lỗi', () => {
  assert.equal(QF.parseTime('').time, 15);
  assert.equal(QF.parseTime('20s').time, 20);
  assert.equal(QF.parseTime('20 giây').time, 20);
  assert.match(QF.parseTime('3').error, /từ 5 đến 120/);
  assert.match(QF.parseTime('nhanh').error, /không phải là số/);
});

test('dòng lỗi được đánh dấu kèm lý do và số dòng thật trong file', () => {
  const { rows } = QF.rowsToQuestions([
    QF.HEADER,
    ['Đủ', 'a', 'b', 'c', 'd', 'A', ''],
    ['Thiếu C', 'a', 'b', '', 'd', 'X', '200'],
  ]);
  assert.equal(rows[0].ok, true);
  assert.equal(rows[1].ok, false);
  assert.equal(rows[1].line, 3);
  assert.deepEqual(rows[1].errors, ['thiếu đáp án C', 'đáp án đúng "X" không hợp lệ (dùng A, B, C, D)', 'thời gian 200 giây phải từ 5 đến 120']);
});

test('JSON: nhận định dạng của game và mảng câu hỏi', () => {
  const quiz = { title: 'Bộ A', questions: [{ question: 'Q', answers: ['1', '2', '3', '4'], correct: 3, time: 12 }] };
  assert.deepEqual(QF.jsonToQuestions(quiz).title, 'Bộ A');
  assert.deepEqual(QF.jsonToQuestions(quiz).rows[0].data, quiz.questions[0]);
  assert.equal(QF.jsonToQuestions(quiz.questions).rows[0].ok, true);
  assert.equal(QF.jsonToQuestions([{ question: 'Q', answers: ['1', '2'], correct: 9 }]).rows[0].ok, false);
  assert.throws(() => QF.jsonToQuestions({ foo: 1 }), /questions/);
});

test('xuất CSV rồi nhập lại được đúng như cũ (kể cả dấu phẩy, ngoặc kép, xuống dòng)', () => {
  const quiz = {
    title: 'Khứ hồi',
    questions: [
      { question: 'Có "ngoặc", phẩy\nvà xuống dòng?', answers: ['một, hai', 'ba', 'bốn', 'năm'], correct: 2, time: 25 },
      { question: 'Câu 2', answers: ['a', 'b', 'c', 'd'], correct: 0, time: 15 },
    ],
  };
  const csv = QF.toCsv(quiz);
  assert.ok(csv.startsWith('\uFEFFCâu hỏi,'));
  const { text } = QF.decodeText(enc(csv));
  const { rows } = QF.rowsToQuestions(QF.parseCsv(text));
  assert.deepEqual(rows.map((r) => r.data), quiz.questions);
  assert.ok(rows.every((r) => r.ok));
});

test('tên file giữ tiếng Việt, bỏ ký tự không hợp lệ; tên bộ lấy lại từ tên file', () => {
  assert.equal(QF.fileName('Chương 1: Mở đầu / Ôn tập?', 'xlsx'), 'Chương 1 Mở đầu Ôn tập.xlsx');
  assert.equal(QF.titleFromFileName('Chủ nghĩa_xã hội.csv'), 'Chủ nghĩa xã hội');
});
