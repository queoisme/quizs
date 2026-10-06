'use strict';
/* Lưu bộ câu hỏi, mỗi bộ một file JSON. Dùng khi chạy trên máy (không cần database). */
const fs = require('fs/promises');
const path = require('path');
const { ID_RE, newId } = require('./ids');

function createFileStore({ dir }) {
  const quizPath = (id) => path.join(dir, `${id}.json`);

  async function writeQuiz(quiz) {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${quizPath(quiz.id)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(quiz, null, 2));
    await fs.rename(tmp, quizPath(quiz.id));
  }

  async function readQuiz(id) {
    if (!ID_RE.test(id)) return null;
    try {
      return JSON.parse(await fs.readFile(quizPath(id), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  return {
    name: `file (${dir})`,

    async init() {
      await fs.mkdir(dir, { recursive: true });
    },

    async close() {},

    async listQuizzes() {
      await fs.mkdir(dir, { recursive: true });
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
      const out = [];
      for (const f of files) {
        try {
          const q = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
          out.push({
            id: q.id,
            title: q.title,
            count: q.questions.length,
            totalSec: q.questions.reduce((sum, x) => sum + x.time, 0),
            updatedAt: q.updatedAt,
          });
        } catch (err) {
          console.warn(`Bỏ qua file câu hỏi lỗi ${f}: ${err.message}`);
        }
      }
      return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },

    readQuiz,

    async createQuiz(data) {
      const now = new Date().toISOString();
      const quiz = { id: newId(), ...data, createdAt: now, updatedAt: now };
      await writeQuiz(quiz);
      return quiz;
    },

    async updateQuiz(id, data) {
      const existing = await readQuiz(id);
      if (!existing) return null;
      const quiz = { id: existing.id, ...data, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
      await writeQuiz(quiz);
      return quiz;
    },

    async deleteQuiz(id) {
      if (!ID_RE.test(id)) return false;
      try {
        await fs.unlink(quizPath(id));
        return true;
      } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
      }
    },

    /* Ghi nguyên bộ câu hỏi (giữ id và thời gian), ghi đè nếu đã có — dùng cho script import */
    async importQuiz(quiz) {
      await writeQuiz(quiz);
    },
  };
}

module.exports = { createFileStore };
