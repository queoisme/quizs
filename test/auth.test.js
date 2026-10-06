'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuth, safeNext, COOKIE } = require('../src/auth');

test('token hợp lệ được chấp nhận; bị sửa, hết hạn hoặc khác khoá thì bị từ chối', () => {
  const auth = createAuth({ password: 'bi-mat', secret: 's1' });
  const token = auth.issueToken();
  assert.equal(auth.verifyToken(token), true);
  assert.equal(auth.isAdmin(`other=1; ${COOKIE}=${token}`), true);

  const [exp, sig] = token.split('.');
  assert.equal(auth.verifyToken(`${Number(exp) + 1}.${sig}`), false); // tự kéo dài hạn
  assert.equal(auth.verifyToken(`${exp}.${sig.slice(0, -1)}x`), false);
  assert.equal(auth.verifyToken(token, Number(exp) + 1), false); // hết hạn
  assert.equal(createAuth({ password: 'bi-mat', secret: 's2' }).verifyToken(token), false);
  assert.equal(auth.verifyToken(''), false);
  assert.equal(auth.isAdmin(undefined), false);
});

test('kiểm tra mật khẩu', () => {
  const auth = createAuth({ password: 'bi-mat' });
  assert.equal(auth.checkPassword('bi-mat'), true);
  assert.equal(auth.checkPassword('bi-mat '), false);
  assert.equal(auth.checkPassword(undefined), false);
});

test('không đặt mật khẩu thì ai cũng là quản trị (chế độ dev)', () => {
  const auth = createAuth({ password: '' });
  assert.equal(auth.enabled, false);
  assert.equal(auth.isAdmin(undefined), true);
  assert.equal(auth.checkPassword(''), false);
});

test('chỉ chuyển hướng về đường dẫn nội bộ sau khi đăng nhập', () => {
  assert.equal(safeNext('/editor?id=1'), '/editor?id=1');
  assert.equal(safeNext('//evil.com'), '/host');
  assert.equal(safeNext('https://evil.com'), '/host');
  assert.equal(safeNext(undefined), '/host');
});
