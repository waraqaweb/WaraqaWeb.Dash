/* eslint-disable no-console */

// End-to-end verification script:
// 1) Register a new user
// 2) Login with old password
// 3) Change password
// 4) Ensure old password login fails
// 5) Ensure new password login succeeds
//
// Usage: node backend/scripts/verifyChangePassword.js

const base = process.env.API_BASE_URL || 'http://127.0.0.1:5000/api';

async function parseJsonSafely(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function request(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await parseJsonSafely(res);
  return { status: res.status, body: json };
}

async function main() {
  const email = `test.pw.${Date.now()}@example.com`;
  const password1 = 'OldPass123';
  const password2 = 'NewPass456';

  console.log('API:', base);
  console.log('Email:', email);

  console.log('\n1) Register...');
  const reg = await request('POST', '/auth/register', {
    firstName: 'Test',
    lastName: 'Pw',
    email,
    password: password1,
    confirmPassword: password1,
    role: 'guardian',
  });
  console.log('register', reg.status, reg.body?.message || reg.body);

  console.log('\n2) Login with old password...');
  const login1 = await request('POST', '/auth/login', { email, password: password1 });
  console.log('login1', login1.status, login1.body?.message || '');
  const token = login1.body?.token;
  if (!token) {
    console.error('No token returned:', login1.body);
    process.exit(2);
  }

  console.log('\n3) Change password...');
  const ch = await request('PUT', '/auth/change-password', {
    currentPassword: password1,
    newPassword: password2,
  }, token);
  console.log('change', ch.status, ch.body?.message || ch.body);

  console.log('\n4) Login with old password (should fail)...');
  const loginOld = await request('POST', '/auth/login', { email, password: password1 });
  console.log('loginOld', loginOld.status, loginOld.body?.message || loginOld.body);

  console.log('\n5) Login with new password (should succeed)...');
  const login2 = await request('POST', '/auth/login', { email, password: password2 });
  console.log('login2', login2.status, login2.body?.message || '');

  const ok = login1.status === 200 && ch.status < 300 && loginOld.status >= 400 && login2.status === 200;
  if (!ok) {
    console.error('\nFAIL: unexpected results');
    process.exit(1);
  }

  console.log('\nPASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
