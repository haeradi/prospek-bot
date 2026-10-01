'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=()=>fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const css=()=>fs.readFileSync(path.join(__dirname,'../public/login.css'),'utf8');

test('login profesional mempertahankan kontrak autentikasi',()=>{const page=html();assert.match(page,/id="auth" class="auth auth-premium"/);assert.match(page,/id="loginForm"/);assert.match(page,/name="email"[^>]*autocomplete="username"/);assert.match(page,/name="password"[^>]*autocomplete="current-password"/);assert.match(page,/id="registerForm"/);assert.match(page,/id="toggleAuth"/)});

test('login memiliki hierarki brand, trust signal, dan CTA akses',()=>{const page=html();assert.match(page,/auth-brandline/);assert.match(page,/auth-benefits/);assert.match(page,/auth-trust/);assert.match(page,/auth-secure-badge/);assert.match(page,/auth-context/);assert.match(page,/Portal Tools/);assert.match(page,/Astra Motor Penajam/);assert.doesNotMatch(page,/Portal Prospek/)});

test('login responsif, aksesibel, dan reduced-motion safe',()=>{const style=css();assert.match(style,/\.auth-premium/);assert.match(style,/@media\(max-width:900px\)/);assert.match(style,/@media\(max-width:600px\)/);assert.match(style,/@media\(prefers-reduced-motion:reduce\)/);assert.match(style,/focus-visible/)});

test('login tetap rapi pada layar laptop pendek dan aset dilayani server',()=>{const style=css(),server=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');assert.match(style,/@media\(max-height:680px\) and \(min-width:901px\)/);assert.match(style,/\.auth-premium aside small\{border:0;padding:0\}/);assert.match(server,/['"]\/login\.css['"]/) });
