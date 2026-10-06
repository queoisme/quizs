'use strict';
/*
 * Đăng nhập quản trị bằng một mật khẩu chung (ADMIN_PASSWORD).
 * Đăng nhập đúng thì nhận cookie "hạn dùng.chữ ký HMAC"; server chỉ cần khoá bí mật để kiểm tra,
 * không phải lưu phiên đăng nhập ở đâu cả.
 */
const crypto = require('crypto');
const express = require('express');

const COOKIE = 'quiz_admin';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const LOGIN_LIMIT = 10; // số lần nhập sai tối đa…
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // …trong 15 phút cho mỗi IP

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/* Chỉ cho chuyển hướng về đường dẫn trong cùng trang web */
const safeNext = (next) => (typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : '/host');

/**
 * @param {object} opts
 * @param {string} [opts.password] bỏ trống = tắt đăng nhập
 * @param {string} [opts.secret] khoá ký cookie
 */
function createAuth({ password, secret = crypto.randomBytes(32).toString('hex') }) {
  const enabled = Boolean(password);
  const sign = (exp) => crypto.createHmac('sha256', secret).update(String(exp)).digest('base64url');

  function issueToken(now = Date.now()) {
    const exp = now + MAX_AGE_MS;
    return `${exp}.${sign(exp)}`;
  }

  function verifyToken(token, now = Date.now()) {
    const [exp, sig] = String(token || '').split('.');
    if (!exp || !sig || !(Number(exp) > now)) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(sign(exp));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // So sánh băm SHA-256 có độ dài cố định để không lộ thông tin qua thời gian phản hồi
  const checkPassword = (input) => enabled && crypto.timingSafeEqual(sha256(input), sha256(password));

  const isAdmin = (cookieHeader) => !enabled || verifyToken(parseCookies(cookieHeader)[COOKIE]);

  function requirePage(req, res, next) {
    if (isAdmin(req.headers.cookie)) return next();
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }

  function requireApi(req, res, next) {
    if (isAdmin(req.headers.cookie)) return next();
    res.status(401).json({ errors: ['Cần đăng nhập quản trị'] });
  }

  const attempts = new Map(); // ip -> {count, resetAt}

  const router = express.Router();
  router.post('/login', (req, res) => {
    if (!enabled) return res.json({ ok: true, next: safeNext(req.body?.next) });
    const now = Date.now();
    const a = attempts.get(req.ip);
    if (a && a.resetAt > now && a.count >= LOGIN_LIMIT) {
      return res.status(429).json({ errors: ['Nhập sai quá nhiều lần, thử lại sau 15 phút'] });
    }
    if (!checkPassword(req.body?.password)) {
      const fresh = !a || a.resetAt <= now;
      attempts.set(req.ip, { count: fresh ? 1 : a.count + 1, resetAt: fresh ? now + LOGIN_WINDOW_MS : a.resetAt });
      return res.status(401).json({ errors: ['Sai mật khẩu'] });
    }
    attempts.delete(req.ip);
    res.cookie(COOKIE, issueToken(now), {
      httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE_MS, path: '/',
    });
    res.json({ ok: true, next: safeNext(req.body?.next) });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  return { enabled, issueToken, verifyToken, checkPassword, isAdmin, requirePage, requireApi, router };
}

module.exports = { createAuth, parseCookies, safeNext, COOKIE };
