'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
const html=read('index.html'),app=read('app.js');

test('portal memiliki pusat notifikasi aksesibel dan dialog konfirmasi profesional',()=>{assert.match(html,/id="notificationCenter"/);assert.match(html,/aria-live="polite"/);assert.match(html,/id="portalConfirm"/);assert.match(html,/notification-ui\.css\?v=/);assert.match(html,/notification-ui\.js\?v=/)});
test('notifikasi mendukung tipe sukses error warning info, tutup, progress, dan mobile',()=>{const js=read('notification-ui.js'),css=read('notification-ui.css');for(const type of ['success','error','warning','info'])assert.match(js,new RegExp(type));assert.match(js,/aria-label.*Tutup/);assert.match(js,/while\(center\.firstElementChild\)/);assert.match(css,/notification-progress/);assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)/)});
test('app memakai pusat notifikasi dan tidak memakai confirm browser',()=>{assert.match(app,/PortalUI\.toast/);assert.match(app,/PortalUI\.confirm/);assert.doesNotMatch(app,/if\(!(?:await )?confirm\(/)});
