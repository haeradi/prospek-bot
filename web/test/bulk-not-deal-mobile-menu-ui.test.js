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
