'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');

test('Bulk Not Deal exposes one bottom confirm-all button only after a nonempty server preview',()=>{
  assert.match(html,/<button id="bulkConfirm"[^>]*hidden[^>]*>Bulk Not Deal<\/button>/);
  assert.match(js,/\$\('#bulkConfirm'\)\.hidden=!\(b\.operation\.total>0&&\(b\.operation\.items\|\|\[\]\)\.length>0\)/);
  assert.match(js,/rows\.append\(row\).*\$\('#bulkConfirm'\)\.hidden=/s);
});

test('confirm-all requires explicit browser confirmation before the existing snapshot confirm endpoint',()=>{
  assert.match(js,/\$\('#bulkConfirm'\)\.onclick=async\(\)=>\{if\(!bulkOperation\)return;if\(!confirm\(`[^`]*snapshot[^`]*`\)\)return;try\{const b=await api\(`\/api\/assist\/bulk-not-deal\/\$\{bulkOperation\.id\}\/confirm`/s);
  assert.equal((js.match(/bulk-not-deal\/\$\{bulkOperation\.id\}\/confirm`/g)||[]).length,1,'confirm-all performs exactly one mutation request');
});

test('confirm-all keeps UNKNOWN visible and offers no retry mutation',()=>{
  assert.match(js,/tidak pasti \$\{op\.counts\?\.UNKNOWN\|\|0\}/);
  assert.doesNotMatch(js,/bulkConfirm[^;]*(retry|ulang)/i);
});
