'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

test('draft list exposes safe STAR preview-confirm-cancel-recover flow', () => {
  assert.match(source, /Kirim ke STAR/);
  assert.match(source, /act\(op,'CONFIRM'\)/);
  assert.match(source, /act\(op,'CANCEL'\)/);
  assert.match(source, /act\(op,'RECOVER'\)/);
  assert.match(source, /crypto\.randomUUID/);
  assert.match(source, /PREVIEW/);
  assert.match(source, /PARTIAL/);
  assert.match(source, /UNKNOWN/);
});

test('STAR operation polling is bounded to 30 seconds', () => {
  assert.match(source, /STAR_POLL_MAX_MS=30000/);
  assert.match(source, /Date\.now\(\)-started<STAR_POLL_MAX_MS/);
});

test('STAR status copy warns against blind create retry and renders remote number safely', () => {
  assert.match(source, /Jangan ulangi create/i);
  assert.match(source, /starNumber/);
  assert.doesNotMatch(source, /innerHTML\s*=\s*`[^`]*\$\{/);
});

test('Bulk Input dan Bulk Not Deal berada pada menu/view terpisah', () => {
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.match(html, /data-view="bulkInput"/);assert.match(html, /id="bulkInputView"/);
  assert.match(html, /data-view="bulkNotDeal"/);assert.match(html, /id="bulkNotDealView"/);
  assert.match(source, /bulkInput:'Bulk Input Prospek'/);assert.match(source, /bulkNotDeal:'Bulk Not Deal'/);
});

test('Bulk Not Deal preview menampilkan nomor, nama, dan status melalui textContent', () => {
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.match(html, /id="bulkPreviewRows"/);
  assert.match(source, /bulkPreviewRows/);
  assert.match(source, /x\.name/);
  assert.match(source, /textContent/);
});

test('Bulk Not Deal menjelaskan batch maksimum 100 dan preview berikutnya', () => {
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.match(html, /maksimal 100 prospek eligible/);
  assert.match(source, /Batch ini berisi/);
  assert.match(source, /preview kembali untuk batch berikutnya/);
});

test('koneksi ASSIST expired membuka kembali form login', () => {
  assert.match(source, /REAUTH_REQUIRED/);
  assert.match(source, /form\.hidden=!reauth/);
});

test('semua kesalahan format Excel menampilkan notifikasi template yang jelas', () => {
  for (const code of ['BATCH_ROWS_INVALID','BATCH_HEADERS_INVALID','BATCH_ROW_LIMIT','BATCH_FORMAT_INVALID','BATCH_ENCODING_INVALID','BATCH_XLSX_INVALID']) assert.match(source, new RegExp(code));
  assert.match(source, /Isi Excel tidak sesuai format template/);
  assert.match(source, /Baris \$\{first\.row\}/);
  assert.match(source, /REQUIRED_FOR_MEDIUM_HOT/);
  assert.match(source, /NIK_16_DIGITS/);
  assert.match(source, /baris \$\{loc\.row\}, kolom \$\{loc\.column\}/);
});
