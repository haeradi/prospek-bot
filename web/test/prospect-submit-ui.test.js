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
  assert.match(source, /BATCH_REGION_UNKNOWN/);
  assert.match(source, /tidak ditemukan pada data ASSIST/);
  assert.match(source, /NIK_16_DIGITS/);
  assert.match(source, /baris \$\{loc\.row\}, kolom \$\{loc\.column\}/);
});

test('HTML tidak merender tag penutup rusak sebagai teks',()=>{const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');assert.doesNotMatch(html,/(^|\n)\/div>/)});

test('login menampilkan pesan rate limit yang presisi',()=>{const js=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');assert.match(js,/RATE_LIMITED[^;]+Terlalu banyak percobaan/)});

test('Input Prospek menampilkan riwayat rapi, retensi 24 jam, dan tombol hapus',()=>{const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8'),js=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');assert.match(html,/Riwayat Input Prospek/);assert.match(html,/terhapus otomatis setelah 24 jam/);assert.match(js,/Hapus riwayat/);assert.match(js,/method:'DELETE'/);assert.match(js,/confirm\(/)});

test('Admin dapat memilih Sales dan menghubungkan ASSIST pada Sales aktif',()=>{const html=fs.readFileSync(require('path').join(__dirname,'../public/index.html'),'utf8'),js=fs.readFileSync(require('path').join(__dirname,'../public/app.js'),'utf8');for(const id of ['activeSalesSelect','activeSalesConnectForm','dashboardProspects','dashboardDeals','dashboardLeads'])assert.match(html,new RegExp(`id=\"${id}\"`));assert.doesNotMatch(html,/id="dashboardLost"/);assert.match(html,/Target/);assert.match(html,/Terjual/);assert.match(html,/Prospek/);assert.match(html,/Workload/);assert.match(js,/assist-login-jobs/);assert.match(js,/activeSalesGeneration/)});
