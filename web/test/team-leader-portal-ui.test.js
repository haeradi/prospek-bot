'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=()=>fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const appJs=()=>fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const teamLeaderJs=()=>fs.readFileSync(path.join(__dirname,'../public/team-leader.js'),'utf8');
const js=()=>appJs()+'\n'+teamLeaderJs();
const css=()=>fs.readFileSync(path.join(__dirname,'../public/team-leader.css'),'utf8');

test('portal asli menyediakan view dashboard TEAMLEAD terpisah',()=>{
  const page=html();
  assert.match(page,/id="teamLeaderView"/);
  assert.match(page,/id="tlPeriodMonth"/);
  assert.match(page,/id="tlProspectChart"/);
  assert.match(page,/id="tlTeamRows"/);
  assert.match(page,/id="tlActivityList"/);
  assert.match(page,/Alokasi Target Tim/);
  assert.match(page,/Aktivitas Lapangan/);
});

test('role TEAMLEAD diarahkan ke API khusus tanpa mengubah jalur Sales atau Admin',()=>{
  const source=js();
  assert.match(source,/u\.role==='TEAMLEAD'/);
  assert.match(source,/\/api\/team-leader\/dashboard/);
  assert.match(source,/body\.activities/);
  assert.match(source,/tlActivityList/);
  assert.match(source,/if\(u\.role==='SALES'\)\{loadDashboardAssist\(\)\}/);
  assert.match(source,/setupActiveSales\(\)/);
  assert.match(source,/textContent/);
  assert.doesNotMatch(source,/tlTeamRows[^\n]*innerHTML/);
});

test('TEAMLEAD memiliki navigasi koneksi ASSIST mandiri dan dapat kembali ke dashboard',()=>{const page=html(),source=js();assert.match(page,/id="teamLeaderAssistNav"/);assert.match(page,/id="primaryDashboardNav"/);assert.match(source,/teamLeaderAssistNav/);assert.match(source,/u\.role==='TEAMLEAD'.*hidden=false/);assert.match(source,/primaryDashboardNav.*dataset\.view=u\.role==='TEAMLEAD'\?'teamLeader':'home'/)});

test('dashboard TEAMLEAD responsif dan menghormati reduced motion',()=>{
  const style=css();
  assert.match(style,/\.tl-dashboard/);
  assert.match(style,/@media\(max-width:720px\)/);
  assert.match(style,/prefers-reduced-motion/);
  assert.match(style,/min-height:44px/);
});

test('Koneksi ASSIST tetap berada di dalam container content',()=>{
  const page=html();
  assert.doesNotMatch(page,/<\/div>\n<\/div>\n<div id="assistDetailView"/);
  assert.match(page,/<div id="assistDataView"[\s\S]*?<div id="assistDetailView"[\s\S]*?<div id="assistView"/);
});
