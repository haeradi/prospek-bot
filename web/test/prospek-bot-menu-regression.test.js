'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../../bot.js'),'utf8');
test('Bulk Not Deal bot mempertahankan snapshot nama sampai konfirmasi',()=>{
 assert.match(source, /_ndNames: allNames/);
 assert.match(source, /const NOTDEAL_REASON_ID = 'Ada keperluan lain';/);
 assert.doesNotMatch(source, /convSet\(chatId, \{ \.\.\.s, step: 'notdeal_confirm' \}\);/);
});
test('Bulk Not Deal memakai snapshot aman maksimum 200, bukan re-fetch cursor saat mutation',()=>{
 const execute=source.slice(source.indexOf("if (data === 'notdeal:do')"),source.indexOf('conv.delete(chatId)',source.indexOf("if (data === 'notdeal:do')")));
 assert.match(source, /const NOTDEAL_MAX_ITEMS = 200;/);
 assert.match(source, /_ndItems: allItems/);
 assert.match(execute, /const snapshotItems = Array\.isArray\(s\._ndItems\)/);
 assert.doesNotMatch(execute, /getCustomerProspectFromCustomers\(first: 10/);
});
test('read-only STAR query retry body kosong tetapi mutation tidak diulang',()=>{
 assert.match(source, /const attempts = query\.includes\('mutation'\) \? 1 : 3;/);
 assert.match(source, /STAR_EMPTY_RESPONSE/);
 assert.match(source, /const first = Math\.min\(25, remaining\);/);
});
test('callback Telegram kedaluwarsa tidak menjatuhkan bot',()=>{
 assert.match(source, /answerCallbackQuery\(q\.id\)\.catch/);
});
test('EOM mutation tidak berjalan otomatis saat startup',()=>{
 assert.doesNotMatch(source, /\/\/ ====== START ======\s*\ncheckEom\(\)/);
});
