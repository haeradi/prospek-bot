'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const path=require('node:path');
const source=()=>fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
test('hasil terminal mengganti Batalkan menjadi Kembali ke Daftar',()=>{const js=source();assert.match(js,/textContent=terminal\?'Kembali ke Daftar':'Batalkan'/);assert.match(js,/submitAllOperation&&!\['SUCCEEDED','PARTIAL','FAILED','UNKNOWN','CANCELLED'\]\.includes/)});
test('daftar lokal menampilkan alasan timeout dan menjelaskan motor LOW tidak diperlukan',()=>{const js=source();assert.match(js,/ASSIST lambat, silakan kirim ulang/);assert.match(js,/Motor tidak diperlukan/);assert.match(js,/x\.errorCode/)});
test('pemantauan bulk tidak berhenti setelah batas polling 20 detik',()=>{const js=source();assert.doesNotMatch(js,/for\(let n=0;n<20;n\+\+\)/);assert.doesNotMatch(js,/POLLING_LIMIT/);assert.match(js,/while\(true\).*setTimeout/s)});
