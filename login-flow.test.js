'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyLoginSnapshot, formatLoginDiagnostic, recoverBlankAssistLogin, waitForPostUsernameState } = require('./login-flow');

test('dashboard ASSIST setelah username melewati password', () => {
  assert.equal(classifyLoginSnapshot({
    url: 'https://assist.star.astra.co.id/dashboard',
    passwordVisible: false, usernameVisible: false, dashboardVisible: true,
  }), 'dashboard');
});

test('halaman Microsoft dengan selector password meminta pengisian password', () => {
  assert.equal(classifyLoginSnapshot({
    url: 'https://login.microsoftonline.com/common/login',
    passwordVisible: true, usernameVisible: false, dashboardVisible: false,
  }), 'password');
});

test('halaman Microsoft baru dikenali dari judul Enter password walau input terlambat terlihat', () => {
  assert.equal(classifyLoginSnapshot({
    url: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize',
    passwordVisible: false, usernameVisible: false, dashboardVisible: false,
    heading: 'Enter password', bodyText: 'Enter password',
  }), 'password');
});

test('halaman tak dikenal menghasilkan diagnostik aman dan spesifik', () => {
  const message = formatLoginDiagnostic('https://example.test/mystery?token=SECRET', 'Unexpected screen');
  assert.equal(message, 'Halaman login tidak dikenali: example.test/mystery — Unexpected screen');
  assert.doesNotMatch(message, /SECRET/);
});

test('halaman /login ASSIST tidak dianggap dashboard hanya karena hostname', () => {
  assert.equal(classifyLoginSnapshot({
    url: 'https://assist.star.astra.co.id/login',
    passwordVisible: false, usernameVisible: true, dashboardVisible: false,
  }), 'intermediary');
});

test('state password yang baru muncul pada pemeriksaan terakhir tidak salah dianggap timeout', async () => {
  let reads = 0;
  const password = { first: () => password, isVisible: async () => ++reads >= 2 };
  const hidden = { first: () => hidden, isVisible: async () => false, textContent: async () => '' };
  const body = { ...hidden, innerText: async () => reads >= 2 ? 'Enter password' : '' };
  const page = {
    url: () => 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize',
    locator: selector => selector.includes('password') || selector.includes('passwd') || selector.includes('i0118') ? password : selector === 'body' ? body : hidden,
    waitForTimeout: async () => {},
  };
  assert.equal(await waitForPostUsernameState(page, 'user@example.com', { timeout: 0 }), 'password');
});

test('blank shell ASSIST /login direload cache-bypass secara terbatas lalu menemukan form', async () => {
  let navigations = 0;
  const states = [
    { url: 'https://assist.star.astra.co.id/login', usernameVisible: false, passwordVisible: false, dashboardVisible: false, accountPickerVisible: false, heading: '', bodyText: '' },
    { url: 'https://assist.star.astra.co.id/login', usernameVisible: true, passwordVisible: false, dashboardVisible: false, accountPickerVisible: false, heading: 'Login', bodyText: 'Login' },
  ];
  const result = await recoverBlankAssistLogin({}, {
    maxRecoveries: 2, snapshotFn: async () => states.shift(),
    navigateFn: async (_page, url) => { navigations++; assert.match(url, /assist_retry=1/); },
    sleepFn: async () => {},
  });
  assert.equal(result.state, 'intermediary');
  assert.equal(navigations, 1);
});

test('blank shell recovery berhenti setelah batas retry dan tidak mengaku authenticated', async () => {
  let navigations = 0;
  const blank = { url: 'https://assist.star.astra.co.id/login', usernameVisible: false, passwordVisible: false, dashboardVisible: false, accountPickerVisible: false, heading: '', bodyText: '' };
  const result = await recoverBlankAssistLogin({}, {
    maxRecoveries: 2, snapshotFn: async () => blank,
    navigateFn: async () => { navigations++; }, sleepFn: async () => {},
  });
  assert.equal(result.state, 'unknown');
  assert.equal(navigations, 2);
});