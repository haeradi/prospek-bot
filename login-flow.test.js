'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyLoginSnapshot, formatLoginDiagnostic } = require('./login-flow');

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