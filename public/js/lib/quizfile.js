'use strict';
/*
 * Đọc / ghi bộ câu hỏi dạng CSV, Excel (.xlsx) và JSON.
 * Các hàm ở đây không đụng tới giao diện nên chạy được cả trên trình duyệt lẫn Node (để test).
 *
 * Mỗi dòng là một câu hỏi: Câu hỏi | Đáp án A | Đáp án B | Đáp án C | Đáp án D | Đáp án đúng | Thời gian (giây)
 */
const QuizFile = (() => {
  const DEFAULT_TIME = 15;
  const HEADER = ['Câu hỏi', 'Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D', 'Đáp án đúng', 'Thời gian (giây)'];
  const LETTERS_ABCD = ['A', 'B', 'C', 'D'];

  /* Bỏ dấu, chữ thường, chỉ giữ chữ và số: "Thời gian (giây)" → "thoi gian giay" */
  const fold = (s) => String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // Tên cột chấp nhận được (đã fold). Tên một chữ cái chỉ khớp chính xác.
  const COLUMN_ALIASES = {
    question: ['cau hoi', 'question', 'noi dung', 'noi dung cau hoi', 'cau'],
    a: ['dap an a', 'a', 'answer a', 'answer 1', 'option a', 'option 1', 'lua chon a', 'phuong an a'],
    b: ['dap an b', 'b', 'answer b', 'answer 2', 'option b', 'option 2', 'lua chon b', 'phuong an b'],
    c: ['dap an c', 'c', 'answer c', 'answer 3', 'option c', 'option 3', 'lua chon c', 'phuong an c'],
    d: ['dap an d', 'd', 'answer d', 'answer 4', 'option d', 'option 4', 'lua chon d', 'phuong an d'],
    correct: ['dap an dung', 'dung', 'correct', 'correct answer', 'answer', 'dap an', 'key'],
    time: ['thoi gian', 'thoi gian giay', 'time', 'time limit', 'seconds', 'giay', 'time sec'],
  };
  const DEFAULT_ORDER = ['question', 'a', 'b', 'c', 'd', 'correct', 'time'];

  // Cột số thứ tự ("Question #" của Blooket, "STT"…) thì bỏ qua
  const INDEX_COLUMN = /^\s*(#|stt|no\.?|number|s[ốo] th[ứu] t[ựu]|(question|câu|cau)\s*(#|no\.?|number|s[ốo]))\s*$/i;

  function matchColumn(cell) {
    if (INDEX_COLUMN.test(String(cell ?? ''))) return null;
    const f = fold(cell);
    if (!f) return null;
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.some((a) => f === a || (a.length > 1 && f.startsWith(`${a} `)))) return key;
    }
    return null;
  }

  // ---------- Đọc ----------

  /*
   * Bỏ BOM; thử UTF-8, sai thì đọc theo bảng mã Windows-1258 (CSV lưu từ Excel tiếng Việt đời cũ).
   * Windows-1258 lưu dấu thanh thành ký tự rời ("o" + dấu hỏi) nên chuẩn hoá về dạng dựng sẵn (NFC).
   */
  function decodeText(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
      return { text: text.normalize('NFC'), encoding: 'utf-8' };
    } catch {
      return { text: new TextDecoder('windows-1258').decode(bytes).normalize('NFC'), encoding: 'windows-1258' };
    }
  }

  /* CSV theo RFC 4180: ô có thể nằm trong "...", "" là dấu ngoặc kép, xuống dòng trong ô được giữ nguyên */
  function parseCsv(text) {
    // Đếm dấu phân cách ở phần đầu file, bỏ qua phần trong "..." (ô có thể chứa xuống dòng).
    // Dấu nào nhiều nhất thì chọn; bằng nhau thì ưu tiên Tab, rồi dấu chấm phẩy; không thấy dấu nào thì dùng dấu phẩy.
    const counts = { '\t': 0, ';': 0, ',': 0 };
    let inQuotes = false;
    for (let i = 0; i < Math.min(text.length, 2000); i++) {
      const ch = text[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch in counts) counts[ch] += 1;
    }
    const delimiter = ['\t', ';', ','].reduce((best, ch) => (counts[ch] > counts[best] ? ch : best), '\t');
    if (counts[delimiter] === 0) return parseWith(text, ',');
    return parseWith(text, delimiter);
  }

  function parseWith(text, delimiter) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  function parseCorrect(raw, answers) {
    const value = String(raw ?? '').trim();
    if (!value) return { error: 'thiếu đáp án đúng' };
    if (/^[1-4a-d](\s*[,;/&]\s*[1-4a-d])+$/i.test(value)) {
      return { error: `"${value}": game chỉ chọn được 1 đáp án đúng cho mỗi câu` };
    }
    const f = fold(value);
    if (/^[a-d]$/.test(f)) return { index: f.charCodeAt(0) - 97 };
    if (/^[1-4]$/.test(f)) return { index: Number(f) - 1 };
    const byText = answers.findIndex((a) => a && fold(a) === f);
    if (byText >= 0) return { index: byText };
    return { error: `đáp án đúng "${value}" không hợp lệ (dùng A, B, C, D)` };
  }

  function parseTime(raw) {
    const value = String(raw ?? '').trim();
    if (!value) return { time: DEFAULT_TIME };
    const n = Number(value.replace(/\s*(s|giay|giây|sec|seconds?)$/i, '').replace(',', '.'));
    if (!Number.isFinite(n)) return { error: `thời gian "${value}" không phải là số` };
    const time = Math.round(n);
    if (time < 5 || time > 120) return { error: `thời gian ${time} giây phải từ 5 đến 120` };
    return { time };
  }

  /* Kiểm tra một câu hỏi theo đúng luật của server (src/quizStore.js) */
  function checkQuestion(q) {
    const errors = [];
    if (!q.question) errors.push('thiếu nội dung câu hỏi');
    else if (q.question.length > 300) errors.push('câu hỏi dài quá 300 ký tự');
    q.answers.forEach((a, i) => {
      if (!a) errors.push(`thiếu đáp án ${LETTERS_ABCD[i]}`);
      else if (a.length > 120) errors.push(`đáp án ${LETTERS_ABCD[i]} dài quá 120 ký tự`);
    });
    return errors;
  }

  /**
   * Biến các dòng (mảng ô dạng chuỗi) thành câu hỏi.
   * @returns {{rows: {line: number, ok: boolean, errors: string[], data: object}[], hasHeader: boolean}}
   */
  function rowsToQuestions(table) {
    const nonEmpty = (r) => r.some((c) => String(c ?? '').trim() !== '');
    let start = 0;
    let order = DEFAULT_ORDER;

    // Dòng tên cột: có ít nhất cột câu hỏi và cột đáp án đúng. Tìm trong 10 dòng đầu vì nhiều
    // file mẫu (Blooket, Kahoot…) có dòng tiêu đề phụ ở trên. Hai cột trùng nghĩa thì lấy cột đầu.
    for (let i = 0, seenRows = 0; i < table.length && seenRows < 10; i++) {
      if (!nonEmpty(table[i])) continue;
      seenRows += 1;
      const used = new Set();
      const keys = table[i].map((cell) => {
        const key = matchColumn(cell);
        if (!key || used.has(key)) return null;
        used.add(key);
        return key;
      });
      if (keys.includes('question') && keys.includes('correct')) {
        order = keys;
        start = i + 1;
        break;
      }
    }
    const col = (row, key) => {
      const i = order.indexOf(key);
      return i >= 0 ? String(row[i] ?? '').trim() : '';
    };

    const rows = [];
    for (let i = start; i < table.length; i++) {
      const row = table[i];
      if (!nonEmpty(row)) continue;
      const data = {
        question: col(row, 'question'),
        answers: ['a', 'b', 'c', 'd'].map((k) => col(row, k)),
        correct: null,
        time: DEFAULT_TIME,
      };
      const errors = checkQuestion(data);
      const correct = parseCorrect(col(row, 'correct'), data.answers);
      if (correct.error) errors.push(correct.error);
      else data.correct = correct.index;
      const time = parseTime(col(row, 'time'));
      if (time.error) errors.push(time.error);
      else data.time = time.time;
      rows.push({ line: i + 1, ok: errors.length === 0, errors, data });
    }
    return { rows, hasHeader: start > 0 };
  }

  /* JSON: định dạng của game ({title, questions}) hoặc chỉ một mảng câu hỏi */
  function jsonToQuestions(obj) {
    const list = Array.isArray(obj) ? obj : obj?.questions;
    if (!Array.isArray(list)) throw new Error('File JSON không có danh sách câu hỏi (questions)');
    const rows = list.map((q, i) => {
      const data = {
        question: String(q?.question ?? '').trim(),
        answers: [0, 1, 2, 3].map((j) => String(q?.answers?.[j] ?? '').trim()),
        correct: null,
        time: DEFAULT_TIME,
      };
      const errors = checkQuestion(data);
      const correct = Number.isInteger(q?.correct) ? { index: q.correct } : parseCorrect(q?.correct, data.answers);
      if (correct.error || correct.index < 0 || correct.index > 3) errors.push(correct.error || 'đáp án đúng phải từ 0 đến 3');
      else data.correct = correct.index;
      const time = parseTime(q?.time);
      if (time.error) errors.push(time.error);
      else data.time = time.time;
      return { line: i + 1, ok: errors.length === 0, errors, data };
    });
    return { rows, title: typeof obj?.title === 'string' ? obj.title.trim() : '' };
  }

  /* Tên bộ lấy theo tên file: "Chủ nghĩa xã hội - chương 1.xlsx" → "Chủ nghĩa xã hội - chương 1" */
  const titleFromFileName = (name) => name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim().slice(0, 100);

  // ---------- Ghi ----------

  const toTable = (quiz) => [
    HEADER,
    ...quiz.questions.map((q) => [q.question, ...q.answers, LETTERS_ABCD[q.correct] ?? '', q.time]),
  ];

  function toCsv(quiz) {
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // BOM để Excel mở đúng tiếng Việt
    return `\uFEFF${toTable(quiz).map((r) => r.map(esc).join(',')).join('\r\n')}\r\n`;
  }

  function toJson(quiz) {
    const { title, questions } = quiz;
    return JSON.stringify({ title, questions }, null, 2);
  }

  /* Tên file giữ nguyên tiếng Việt, chỉ bỏ ký tự hệ điều hành không cho phép */
  const fileName = (title, ext) => `${(title || 'bo-cau-hoi').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}.${ext}`;

  const TEMPLATE = {
    title: 'Mẫu bộ câu hỏi',
    questions: [
      { question: 'Thủ đô của Việt Nam là gì?', answers: ['Hà Nội', 'Huế', 'Đà Nẵng', 'TP. Hồ Chí Minh'], correct: 0, time: 15 },
      { question: '2 + 2 = ?', answers: ['3', '4', '5', '22'], correct: 1, time: 10 },
      { question: 'Dòng này để trống thời gian → mặc định 15 giây', answers: ['Đúng', 'Sai', 'Không biết', 'Bỏ qua'], correct: 0, time: '' },
    ],
  };

  return {
    HEADER, DEFAULT_TIME, TEMPLATE,
    fold, matchColumn, decodeText, parseCsv, parseCorrect, parseTime,
    rowsToQuestions, jsonToQuestions, titleFromFileName, toTable, toCsv, toJson, fileName,
  };
})();

if (typeof module !== 'undefined') module.exports = QuizFile;
