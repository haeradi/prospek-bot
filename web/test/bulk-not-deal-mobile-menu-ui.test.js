'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../public/styles.css'),'utf8');

test('Bulk Not Deal tampil pada menu aksi cepat Sales mobile',()=>{
  assert.match(html,/<section class="mobile-quick-actions"[\s\S]*data-view="bulkNotDeal"[\s\S]*Not Deal[\s\S]*<\/section>/);
  assert.match(css,/\.mobile-actions-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('halaman Bulk Not Deal memakai heading dan panel operasional responsif seperti Prospek',()=>{
  assert.match(html,/id="bulkNotDealView" class="bulk-not-deal-view"/);
  assert.match(html,/class="bulk-not-deal-heading"[\s\S]*BULK NOT DEAL[\s\S]*Prospek menjadi Lost/);
  assert.match(html,/class="card formcard bulk-not-deal-card"/);
  assert.match(html,/class="bulk-not-deal-guide"/);
  assert.match(css,/\.bulk-not-deal-heading/);
  assert.match(css,/\.bulk-not-deal-card/);
  assert.match(css,/@media\(max-width:720px\)[\s\S]*#bulkNotDealView \.bulk-not-deal-heading/);
});

test('preview Bulk Not Deal mengikuti workspace ringkas Bulk Excel',()=>{
  for(const id of ['bulkEligibleTotal','bulkVisibleTotal','bulkStatusLabel','bulkPreviewListHead'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/class="bulk-not-deal-summary"/);
  assert.match(html,/class="bulk-not-deal-list-head"/);
  assert.match(css,/#bulkPreviewRows\{display:block/);
  assert.match(css,/\.bulk-prospect-card\{display:grid!important;grid-template-columns:/);
  assert.match(css,/@media\(max-width:720px\)[\s\S]*\.bulk-prospect-card\{grid-template-columns:minmax\(0,1fr\) 104px/);
});

test('ringkasan preview diperbarui dari operation server tanpa mengubah safety gate',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  assert.match(js,/bulkEligibleTotal[^;]*textContent=String\(b\.operation\.total\|\|0\)/);
  assert.match(js,/bulkVisibleTotal[^;]*textContent=String\(\(b\.operation\.items\|\|\[\]\)\.length\)/);
  assert.match(js,/bulkStatusLabel[^;]*textContent=b\.operation\.total\?'Siap ditinjau':'Kosong'/);
  assert.match(js,/PortalUI\.confirm\(\{type:'danger',title:'Bulk Not Deal'/);
});


test('ringkasan Bulk Not Deal direset saat preview baru dan gagal',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  assert.match(js,/bulkEligibleTotal'\)\.textContent='0'.*bulkVisibleTotal'\)\.textContent='0'.*bulkStatusLabel'\)\.textContent='Memuat'/s);
  assert.match(js,/catch\([a-z]\)\{bulkOperation=null;.*bulkStatusLabel'\)\.textContent='Gagal'/s);
});
