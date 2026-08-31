'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../../bot.js'),'utf8');
test('Bulk Not Deal bot mempertahankan snapshot nama sampai konfirmasi',()=>{
 assert.match(source, /_ndNames: allNames/);
 assert.doesNotMatch(source, /convSet\(chatId, \{ \.\.\.s, step: 'notdeal_confirm' \}\);/);
});
test('callback Telegram kedaluwarsa tidak menjatuhkan bot',()=>{
 assert.match(source, /answerCallbackQuery\(q\.id\)\.catch/);
});
test('EOM mutation tidak berjalan otomatis saat startup',()=>{
 assert.doesNotMatch(source, /\/\/ ====== START ======\s*\ncheckEom\(\)/);
});
