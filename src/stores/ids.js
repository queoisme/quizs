'use strict';
const crypto = require('crypto');

// Id bộ câu hỏi: 12 ký tự hex, dùng chung cho mọi cách lưu để link /host?quiz=... không đổi khi chuyển kho
const ID_RE = /^[a-f0-9]{12}$/;
const newId = () => crypto.randomBytes(6).toString('hex');

module.exports = { ID_RE, newId };
