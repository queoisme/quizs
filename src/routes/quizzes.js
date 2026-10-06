'use strict';
/* REST API /api/quizzes */
const express = require('express');
const { validateQuiz, store } = require('../quizStore');

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const notFound = (res) => res.status(404).json({ errors: ['Không tìm thấy bộ câu hỏi'] });

router.get('/', wrap(async (req, res) => {
  res.json(await store.listQuizzes());
}));

router.get('/:id', wrap(async (req, res) => {
  const quiz = await store.readQuiz(req.params.id);
  if (!quiz) return notFound(res);
  res.json(quiz);
}));

router.post('/', wrap(async (req, res) => {
  const { errors, data } = validateQuiz(req.body);
  if (errors.length) return res.status(400).json({ errors });
  res.status(201).json(await store.createQuiz(data));
}));

router.put('/:id', wrap(async (req, res) => {
  const { errors, data } = validateQuiz(req.body);
  if (errors.length) return res.status(400).json({ errors });
  const quiz = await store.updateQuiz(req.params.id, data);
  if (!quiz) return notFound(res);
  res.json(quiz);
}));

router.delete('/:id', wrap(async (req, res) => {
  if (!(await store.deleteQuiz(req.params.id))) return notFound(res);
  res.status(204).end();
}));

module.exports = router;
