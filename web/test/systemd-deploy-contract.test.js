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

test('portal mewajibkan broker Team Leader dan memakai socket yang sama',()=>{
 const portal=fs.readFileSync(path.join(__dirname,'../deploy/prospek-web.service'),'utf8');
 const broker=fs.readFileSync(path.join(__dirname,'../deploy/team-leader-token-broker.service'),'utf8');
 assert.doesNotMatch(portal,/^Requires=team-leader-token-broker\.service$/m);
 assert.match(portal,/^Wants=team-leader-token-broker\.service$/m);
 assert.match(portal,/^After=.*team-leader-token-broker\.service/m);
 assert.match(portal,/^Environment=TEAMLEADER_TOKEN_SOCKET=\/run\/prospek-web-token\/broker\.sock$/m);
 assert.match(broker,/^Environment=TEAMLEADER_TOKEN_SOCKET=\/run\/prospek-web-token\/broker\.sock$/m);
 assert.match(broker,/^TasksMax=64$/m);
});

test('broker membatasi koneksi dan memakai single-flight token fetch',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../deploy/team-leader-token-broker.js'),'utf8');
 assert.match(source,/server\.maxConnections=16/);
 assert.match(source,/tokenFetchWaiters/);
 assert.match(source,/cachedToken/);
});
