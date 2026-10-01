'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=()=>fs.readFileSync('/home/ubuntu/prospek-web-work/public/app.js','utf8');
test('hasil terminal mengganti Batalkan menjadi Kembali ke Daftar',()=>{const js=source();assert.match(js,/textContent=terminal\?'Kembali ke Daftar':'Batalkan'/);assert.match(js,/submitAllOperation&&!\['SUCCEEDED','PARTIAL','FAILED','UNKNOWN','CANCELLED'\]\.includes/)});
test('daftar lokal menampilkan alasan timeout dan menjelaskan motor LOW tidak diperlukan',()=>{const js=source();assert.match(js,/ASSIST lambat, silakan kirim ulang/);assert.match(js,/Motor tidak diperlukan/);assert.match(js,/x\.errorCode/)});
