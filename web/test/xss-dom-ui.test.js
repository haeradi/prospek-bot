'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

test('data API tidak dirender melalui HTML sink', () => {
  assert.doesNotMatch(source, /\.innerHTML\s*=/, 'gunakan textContent/createElement, termasuk saat mengosongkan container');
  assert.doesNotMatch(source, /\.outerHTML\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML\s*\(/);
  assert.doesNotMatch(source, /document\.write\s*\(/);
});

test('render data eksternal memakai node dan textContent', () => {
  for (const field of ['u.fullName', 'r.name', 'p.customerName', 'l.actorName']) {
    assert.match(source, new RegExp(`textContent\\s*=\\s*${field.replace('.', '\\.')}`), `${field} harus masuk textContent`);
  }
  assert.match(source, /document\.createTextNode\(value\|\|'-'\)/, 'detail prospek harus masuk text node');
});
