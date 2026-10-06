'use strict';
/* Lưu bộ câu hỏi trong PostgreSQL (Amazon RDS khi triển khai). Bảng: src/db/schema.sql */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ID_RE, newId } = require('./ids');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

/**
 * @param {object} opts
 * @param {string} opts.connectionString postgres://user:pass@host:5432/db
 * @param {string} [opts.sslCa] nội dung chứng chỉ CA; có thì bắt buộc SSL và xác thực server
 */
function createPgStore({ connectionString, sslCa }) {
  const pool = new Pool({
    connectionString,
    ssl: sslCa ? { ca: sslCa, rejectUnauthorized: true } : undefined,
    max: 5,
  });
  pool.on('error', (err) => console.error('Lỗi kết nối PostgreSQL:', err.message));

  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function insertQuestions(client, quizId, questions) {
    for (const [i, q] of questions.entries()) {
      await client.query(
        `INSERT INTO questions (quiz_id, position, question, answers, correct, time_sec)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [quizId, i, q.question, q.answers, q.correct, q.time],
      );
    }
  }

  const toQuiz = (row, questions) => ({
    id: row.id,
    title: row.title,
    questions: questions.map((q) => ({ question: q.question, answers: q.answers, correct: q.correct, time: q.time_sec })),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });

  return {
    name: 'postgres',

    async init() {
      await pool.query(SCHEMA);
    },

    async close() {
      await pool.end();
    },

    async listQuizzes() {
      const { rows } = await pool.query(`
        SELECT q.id, q.title, q.updated_at, count(qs.position)::int AS count,
               coalesce(sum(qs.time_sec), 0)::int AS total_sec
        FROM quizzes q
        LEFT JOIN questions qs ON qs.quiz_id = q.id
        GROUP BY q.id
        ORDER BY q.updated_at DESC`);
      return rows.map((r) => ({
        id: r.id, title: r.title, count: r.count, totalSec: r.total_sec, updatedAt: r.updated_at.toISOString(),
      }));
    },

    async readQuiz(id) {
      if (!ID_RE.test(id)) return null;
      const quiz = await pool.query('SELECT id, title, created_at, updated_at FROM quizzes WHERE id = $1', [id]);
      if (!quiz.rows.length) return null;
      const qs = await pool.query(
        'SELECT question, answers, correct, time_sec FROM questions WHERE quiz_id = $1 ORDER BY position',
        [id],
      );
      return toQuiz(quiz.rows[0], qs.rows);
    },

    async createQuiz(data) {
      return tx(async (client) => {
        const { rows } = await client.query(
          'INSERT INTO quizzes (id, title) VALUES ($1, $2) RETURNING id, title, created_at, updated_at',
          [newId(), data.title],
        );
        await insertQuestions(client, rows[0].id, data.questions);
        return toQuiz(rows[0], data.questions.map((q) => ({ ...q, time_sec: q.time })));
      });
    },

    async updateQuiz(id, data) {
      if (!ID_RE.test(id)) return null;
      return tx(async (client) => {
        const { rows } = await client.query(
          `UPDATE quizzes SET title = $2, updated_at = now() WHERE id = $1
           RETURNING id, title, created_at, updated_at`,
          [id, data.title],
        );
        if (!rows.length) return null;
        // Thay toàn bộ câu hỏi: đơn giản và đúng thứ tự sau khi kéo thả
        await client.query('DELETE FROM questions WHERE quiz_id = $1', [id]);
        await insertQuestions(client, id, data.questions);
        return toQuiz(rows[0], data.questions.map((q) => ({ ...q, time_sec: q.time })));
      });
    },

    async deleteQuiz(id) {
      if (!ID_RE.test(id)) return false;
      const { rowCount } = await pool.query('DELETE FROM quizzes WHERE id = $1', [id]);
      return rowCount > 0;
    },

    /* Ghi nguyên bộ câu hỏi (giữ id và thời gian), ghi đè nếu đã có — dùng cho script import */
    async importQuiz(quiz) {
      await tx(async (client) => {
        await client.query(
          `INSERT INTO quizzes (id, title, created_at, updated_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET title = $2, created_at = $3, updated_at = $4`,
          [quiz.id, quiz.title, quiz.createdAt, quiz.updatedAt],
        );
        await client.query('DELETE FROM questions WHERE quiz_id = $1', [quiz.id]);
        await insertQuestions(client, quiz.id, quiz.questions);
      });
    },
  };
}

module.exports = { createPgStore };
