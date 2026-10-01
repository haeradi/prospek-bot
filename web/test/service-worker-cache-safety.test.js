'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../public'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
test('precache login.css memakai versi yang sama dengan shell HTML',()=>{const version=html.match(/\/login\.css\?v=(\d+)/)?.[1];assert.ok(version);assert.match(sw,new RegExp(`/login\\.css\\?v=${version}`))});
test('aktivasi hanya menghapus cache shell Portal Tools lama',()=>{assert.match(sw,/startsWith\(['"]portal-tools-shell-/);assert.doesNotMatch(sw,/keys\.map\(k=>caches\.delete\(k\)\)/)});