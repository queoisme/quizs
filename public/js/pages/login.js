'use strict';
const next = new URLSearchParams(location.search).get('next') || '/host';

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#submit').disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#password').value, next }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      location.href = data.next;
      return;
    }
    $('#error').textContent = data.errors?.join('\n') || `Lỗi ${res.status}`;
    $('#password').select();
  } catch {
    $('#error').textContent = 'Không kết nối được server';
  } finally {
    $('#submit').disabled = false;
  }
});
