'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {installProspectSubmitAllService}=require('../src/prospect-submit-all-service');
const source=()=>fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');

function fixture(){const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,status TEXT);CREATE TABLE prospects(id TEXT PRIMARY KEY,owner_id TEXT,status TEXT,created_at TEXT,level TEXT DEFAULT 'LOW',input_origin TEXT DEFAULT 'EXCEL');INSERT INTO users VALUES('u1','SALES','ACTIVE'),('u2','SALES','ACTIVE');`);return{db,service:installProspectSubmitAllService({db,submitService:{}})}}

test('latestActive hanya mengembalikan operasi CONFIRMED/RUNNING terbaru milik owner',async()=>{const x=fixture();const a=await x.service.preview('u1','reload-key-1'),other=await x.service.preview('u2','reload-key-2');x.db.prepare("UPDATE prospect_submit_all_operations SET status='RUNNING',updated_at='2026-01-01' WHERE id=?").run(a.id);x.db.prepare("UPDATE prospect_submit_all_operations SET status='RUNNING',updated_at='2026-01-02' WHERE id=?").run(other.id);assert.equal(x.service.latestActive('u1').id,a.id);assert.equal(x.service.latestActive('u2').id,other.id);x.db.prepare("UPDATE prospect_submit_all_operations SET status='SUCCEEDED' WHERE id=?").run(a.id);assert.equal(x.service.latestActive('u1'),null)});

test('route menyediakan lookup active owner-scoped tanpa CSRF mutation',()=>{const js=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');assert.match(js,/\/api\/prospects\/submit-all\/active/);assert.match(js,/submitAllService\.latestActive\(a\.user_id\)/)});

test('boot Sales memulihkan submit-all aktif, merender lalu melanjutkan polling',()=>{const js=source();assert.match(js,/\/api\/prospects\/submit-all\/active/);assert.match(js,/resumeActiveSubmitAll/);assert.match(js,/showPortal\(b\.user\).*resumeActiveSubmitAll/s);assert.match(js,/boundedPoll\(.*submit-all/s)});

test('selama submit-all aktif draft single-send dan toolbar mutasi disembunyikan atau dinonaktifkan',()=>{const js=source();assert.match(js,/setSubmitAllActive/);assert.match(js,/submitAllPreviewBtn/);assert.match(js,/deleteExcelDraftsPreviewBtn/);assert.match(js,/excel-prospect-action/)});
test('submit-all aktif tetap mengunci kontrol dan menyembunyikan daftar Excel utama',()=>{const js=source();assert.match(js,/function setSubmitAllActive\(active\)[\s\S]*?submitAllPreviewBtn'\)\.hidden=active[\s\S]*?deleteExcelDraftsPreviewBtn'\)\.hidden=active[\s\S]*?excelProspectSection'\)\.hidden=active/)});

test('boot mengunci kontrol sebelum lookup active dan hanya membuka jika lookup memastikan kosong',()=>{const js=source();assert.match(js,/async function resumeActiveSubmitAll\(\)\{setSubmitAllActive\(true\);/);assert.match(js,/if\(!b\.operation\)\{[\s\S]*setSubmitAllActive\(false\);return/);assert.doesNotMatch(js,/catch\(e\)\{setSubmitAllActive\(false\)/)});

test('recovery yang dipanggil ulang memakai satu promise polling',()=>{const js=source();assert.match(js,/submitAllRecoveryPromise/);assert.match(js,/if\(submitAllRecoveryPromise\)return submitAllRecoveryPromise/)});
test('lookup active gagal tetap terkunci dan menyediakan retry persisten yang memakai recovery single-flight',()=>{const js=source(),html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');assert.match(html,/id="submitAllRecoveryRetry"[^>]*hidden/);assert.match(js,/catch\(e\)\{[\s\S]*submitAllRecoveryRetry'\)\.hidden=false/);assert.match(js,/submitAllRecoveryRetry'\)\.onclick=\(\)=>resumeActiveSubmitAll\(\)/);assert.doesNotMatch(js,/catch\(e\)\{setSubmitAllActive\(false\)/)});
test('retry hanya hilang setelah lookup authoritative memastikan tidak ada operasi aktif',()=>{const js=source();assert.match(js,/if\(!b\.operation\)\{[\s\S]*submitAllRecoveryRetry'\)\.hidden=true;setSubmitAllActive\(false\)/);assert.match(js,/setSubmitAllActive\(true\);if\(submitAllRecoveryPromise\)return submitAllRecoveryPromise/)});
