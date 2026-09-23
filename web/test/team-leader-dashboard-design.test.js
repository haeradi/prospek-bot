'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const file=path.join(__dirname,'../design/team-leader-dashboard.html');

test('prototype Team Leader adalah Monitor surface dengan data snapshot yang jujur',()=>{
  const html=fs.readFileSync(file,'utf8');
  assert.match(html,/Dashboard Team Leader/);
  assert.match(html,/ABDUL RAHMADAN HAERADI/);
  assert.match(html,/Snapshot API · 13 September 2026/);
  assert.match(html,/Prospek Harian/);
  assert.match(html,/Alokasi Target Tim/);
  assert.match(html,/Aktivitas Lapangan/);
  assert.match(html,/Leads & Workload/);
  assert.match(html,/data-series="9,97,46,8,54,0,5,8,6,115,52,52,0"/);
  assert.match(html,/DESI NURULHIJA/);
  assert.match(html,/SRI WAHYUNI/);
  assert.doesNotMatch(html,/SAMUEL YUDHA PANGESTU/);
});

test('prototype menyediakan navigasi, filter periode, dan layout mobile',()=>{
  const html=fs.readFileSync(file,'utf8');
  assert.match(html,/aria-label="Navigasi utama"/);
  assert.match(html,/aria-label="Pilih periode"/);
  assert.match(html,/@media\s*\(max-width:\s*720px\)/);
  assert.match(html,/prefers-reduced-motion/);
  assert.match(html,/min-height:\s*44px/);
});

test('prototype mandiri tanpa library atau asset eksternal',()=>{
  const html=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(html,/<script[^>]+src=/);
  assert.doesNotMatch(html,/<link[^>]+href=["']https?:/);
  assert.match(html,/<canvas id="prospectChart"/);
});
