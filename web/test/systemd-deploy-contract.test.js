'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('systemd memberi margin stop lebih besar dari drain parity 45 detik',()=>{
 const unit=fs.readFileSync(path.join(__dirname,'../deploy/prospek-web.service'),'utf8');
 const match=unit.match(/^TimeoutStopSec=(\d+)$/m);
 assert.ok(match,'TimeoutStopSec wajib eksplisit');
 assert.ok(Number(match[1])>45,'systemd tidak boleh membunuh proses sebelum drain parity selesai');
});
