'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../public'),read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('dashboard Sales mobile memiliki hierarki operasional dan navigasi bawah',()=>{
  const html=read('index.html');
  for(const klass of ['mobile-portal-bar','mobile-quick-actions','mobile-bottom-nav']) assert.match(html,new RegExp(`class="[^"]*${klass}`));
  assert.match(html,/class="mobile-bottom-nav"[^>]*hidden/,'nav tersembunyi sebelum role diketahui');
  assert.match(html,/id="mobileLogout"/,'logout mobile tersedia');
  assert.match(read('app.js'),/\$\('#mobileLogout'\)\.onclick=logout/,'logout mobile memakai handler logout existing');
  for(const view of ['home','prospect','bulkInput','assistData','assist']) assert.match(html,new RegExp(`data-view="${view}"`));
  for(const id of ['dashboardDeals','dashboardProspects','dashboardLeads','dashboardWorkloadCount']) assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${id} tetap satu sumber data`);
  assert.doesNotMatch(html,/Andi Saputra|Nur Maya|Rizky Hidayat/,'data contoh tidak boleh masuk produksi');
});

test('CSS mobile memakai KPI 2x2, safe area, dan terisolasi di breakpoint',()=>{
  const css=read('styles.css');
  assert.match(css,/Mobile Sales dashboard v48/);
  assert.match(read('app.js'),/dataset\.role=u\.role/,'role portal ditandai untuk isolasi layout mobile Sales');
  assert.match(css,/@media\(max-width:720px\)/);
  assert.match(css,/\.mobile-kpi-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/\.mobile-portal-bar,\.mobile-quick-actions,\.mobile-bottom-nav\{display:none\}/);
  assert.match(css,/\.mobile-bottom-nav:not\(\[hidden\]\)\{display:grid/);
});

test('PWA memuat versi aset mobile terbaru',()=>{
  const html=read('index.html'),sw=read('sw.js');
  assert.match(html,/styles\.css\?v=51/);
  assert.match(html,/app\.js\?v=67/);
  assert.match(sw,/portal-tools-shell-v52/);
  assert.match(sw,/styles\.css\?v=51/);
});
