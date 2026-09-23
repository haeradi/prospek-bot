'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pub=path.join(__dirname,'../public'),read=n=>fs.readFileSync(path.join(pub,n),'utf8');

test('status sheet tidak mengandung rincian dashboard hardcoded',()=>{
 const js=read('app.js');
 assert.doesNotMatch(js,/\['💵','Tunai','2'/);
 assert.doesNotMatch(js,/\['L','Low','20'/);
 assert.match(js,/dashboardMetrics/);
 assert.match(js,/breakdown/);
 assert.match(js,/salesBreakdown/);
 assert.match(js,/m\.targetUnit/);
 assert.match(js,/m\.salesBreakdown\?\.cash/);
 assert.match(js,/m\.salesBreakdown\?\.credit/);
 assert.match(read('index.html'),/id="dashboardTargetUnit"/);
 for(const id of ['dashboardCash','dashboardCredit','dashboardTargetProspect']) assert.match(read('index.html'),new RegExp(`id="${id}"`));
 assert.match(js,/m\.targetProspect/);
});

test('status sheet memiliki ringkasan total dan layout mobile presisi',()=>{
 const html=read('index.html'),css=read('styles.css');
 for(const id of ['statusSheetTotal','statusSheetSubtitle','statusSheetRows']) assert.match(html,new RegExp(`id="${id}"`));
 assert.match(css,/\.sheet-summary/);
 assert.match(css,/env\(safe-area-inset-bottom\)/);
 assert.match(css,/\.sheet-status-grid/);
});
