'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const path=require('node:path');
const source=()=>fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
test('hasil terminal mengganti Batalkan menjadi Kembali ke Daftar',()=>{const js=source();assert.match(js,/textContent=terminal\?'Kembali ke Daftar':'Batalkan'/);assert.match(js,/submitAllOperation&&!SUBMIT_ALL_TERMINAL\.has/)});
test('COMPLETED adalah terminal: selesai, konfirmasi tersembunyi, dan tombol kembali',()=>{const js=source();assert.match(js,/SUBMIT_ALL_TERMINAL=new Set\(\[[^\]]*'COMPLETED'/);assert.match(js,/SUBMIT_ALL_TERMINAL\.has\(op\.status\)/);assert.match(js,/terminal\?'Kembali ke Daftar':'Batalkan'/)});
test('daftar lokal menampilkan alasan timeout dan menjelaskan motor LOW tidak diperlukan',()=>{const js=source();assert.match(js,/ASSIST lambat, silakan kirim ulang/);assert.match(js,/Motor tidak diperlukan/);assert.match(js,/x\.errorCode/)});
test('pemantauan bulk tidak berhenti setelah batas polling 20 detik',()=>{const js=source();assert.doesNotMatch(js,/for\(let n=0;n<20;n\+\+\)/);assert.doesNotMatch(js,/POLLING_LIMIT/);assert.match(js,/while\(true\).*setTimeout/s)});
