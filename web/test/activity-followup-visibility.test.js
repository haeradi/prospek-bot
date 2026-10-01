'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');

test('tab Activity membersihkan dan menyembunyikan panel follow-up Leads',()=>{
 const start=js.indexOf("$('#ownActivitiesBtn').onclick=async()=>");
 assert.notEqual(start,-1,'handler Activity tersedia');
 const end=js.indexOf('};async function loadSalesOptions',start);
 const handler=js.slice(start,end);
 assert.match(handler,/resetLeadFollowup\(null\)/,'Activity wajib membersihkan panel follow-up');
 assert.match(handler,/\/api\/assist\/activities/,'Activity tetap memuat endpoint Activity');
});
