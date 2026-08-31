'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {installBulkNotDealService}=require('../src/bulk-not-deal-service');
const ELIGIBLE_TEST=new Set(['PROSPECT','LOW','MEDIUM','HOT','HOT_PROSPECT']);

function fixture({prospects,update,tokenFor,delayMs=async()=>{},now='2026-08-29T00:00:00.000Z'}={}){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,status TEXT);');
 db.prepare('INSERT INTO users VALUES(?,?,?)').run('s1','SALES','ACTIVE');db.prepare('INSERT INTO users VALUES(?,?,?)').run('s2','SALES','ACTIVE');db.prepare('INSERT INTO users VALUES(?,?,?)').run('admin','ADMIN','ACTIVE');
 let rows=prospects||[{id:'p1',prospectNumber:'H704-PRS-1',name:'Budi Santoso',status:'HOT',createdAt:'2026-07-01T00:00:00Z'},{id:'p2',prospectNumber:'H704-PRS-2',name:'Siti Aminah',status:'DEAL',createdAt:'2026-07-01T00:00:00Z'},{id:'p3',prospectNumber:'H704-PRS-3',name:'Andi Wijaya',status:'LOW',createdAt:'2026-08-20T00:00:00Z'}],calls=[];
 const readCalls=[];const readClient={listProspects:async()=>{throw new Error('listProspects must never be called')},listProspectsForNotDeal:async(_t,opts)=>{readCalls.push(['list',opts]);const cutoff=Date.parse(opts.cutoffDate),lower=opts.maxAgeDays===undefined?-Infinity:cutoff-opts.maxAgeDays*86400000;return rows.filter(x=>ELIGIBLE_TEST.has(x.status)&&Date.parse(x.createdAt)<=cutoff&&Date.parse(x.createdAt)>=lower).slice(0,opts.maxItems)},findProspectById:async(_t,id,opts)=>{readCalls.push(['find',id,opts]);return rows.find(x=>String(x.id)===id)||null}};
 const service=installBulkNotDealService({db,tokenFor:tokenFor|| (id=>`token-${id}`),readClient,mutationClient:{updateProspectStatus:update|| (async(t,p)=>{calls.push({t,p});return{id:p.prospectId,status:'LOST'}})},delayMs,now:()=>now});
 return{db,service,calls,readCalls,setRows:x=>rows=x};
}

test('preview menyimpan snapshot authoritative eligible menurut cutoff dan melarang IDs client',async()=>{
 const x=fixture();const a=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-key-001');
 assert.equal(a.status,'PREVIEW');assert.equal(a.total,1);assert.equal(a.items.length,1);assert.match(a.items[0].itemId,/^[0-9a-f-]{36}$/);assert.deepEqual({...a.items[0],itemId:undefined},{itemId:undefined,prospectNumber:'H704-PRS-1',name:'Budi Santoso',fromStatus:'HOT',status:'PENDING'});assert.deepEqual(x.db.prepare('SELECT target_id,from_status FROM bulk_not_deal_items').all().map(r=>({...r})),[{target_id:'p1',from_status:'HOT'}]);assert.equal(x.calls.length,0);
 const same=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-key-001');assert.equal(same.id,a.id);
 await assert.rejects(()=>x.service.preview('s1',{cutoffDate:'2026-08-02T00:00:00Z'},'bulk-key-001'),e=>e.code==='IDEMPOTENCY_CONFLICT');
 await assert.rejects(()=>x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z',ids:['p2']},'bulk-key-002'),e=>e.code==='TARGET_IDS_FORBIDDEN');
 await assert.rejects(()=>x.service.preview('admin',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-key-003'),e=>e.code==='FORBIDDEN');
});

test('maxAgeDays membatasi batas bawah dan preview maksimum 100',async()=>{
 const x=fixture({prospects:[{id:'old',status:'PROSPECT',createdAt:'2026-06-01T00:00:00Z'},{id:'ok',status:'HOT_PROSPECT',createdAt:'2026-07-20T00:00:00Z'}]});
 const p=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z',maxAgeDays:30},'bulk-age-01');assert.equal(p.total,1);
 const y=fixture({prospects:Array.from({length:101},(_,i)=>({id:`p${i}`,status:'MEDIUM',createdAt:'2026-07-01T00:00:00Z'}))});const batch=await y.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-max-01');assert.equal(batch.total,100);assert.equal(y.calls.length,0);assert.equal(y.db.prepare('SELECT COUNT(*) n FROM bulk_not_deal_items WHERE operation_id=?').get(batch.id).n,100);
});

test('confirm claim atomik, re-read, revalidasi user/token, satu POST per item dengan alasan portal',async()=>{
 let tokenCalls=0;const x=fixture({prospects:[{id:'p1',status:'HOT',createdAt:'2026-07-01T00:00:00Z'},{id:'p2',status:'LOW',createdAt:'2026-07-02T00:00:00Z'}],tokenFor:id=>{tokenCalls++;return `${id}-${tokenCalls}`}});const p=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-run-01');
 const [a,b]=await Promise.all([x.service.confirm('s1',p.id,{concurrency:3}),x.service.confirm('s1',p.id,{concurrency:3})]);assert.equal(a.status,'SUCCEEDED');assert.equal(b.status,'SUCCEEDED');assert.equal(x.calls.length,2);assert.ok(tokenCalls>=5);for(const c of x.calls)assert.deepEqual(c.p,{prospectId:c.p.prospectId,toStatus:'LOST',reason:'Ada keperluan lain'});
});

test('bulk sequential memberi jeda 30 detik hanya antar mutation',async()=>{
 const sleeps=[];const x=fixture({prospects:[1,2,3].map(i=>({id:`p${i}`,status:'HOT',createdAt:'2026-07-01T00:00:00Z'})),delayMs:async(ms)=>sleeps.push(ms)});const p=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-delay');const r=await x.service.confirm('s1',p.id);assert.equal(r.status,'SUCCEEDED');assert.equal(x.calls.length,3);assert.deepEqual(sleeps,[30000,30000]);
});

test('missing dan status LOST/DEAL menjadi STALE tanpa POST',async()=>{
 const x=fixture({prospects:[{id:'p1',status:'HOT',createdAt:'2026-07-01T00:00:00Z'},{id:'p2',status:'LOW',createdAt:'2026-07-01T00:00:00Z'},{id:'p3',status:'MEDIUM',createdAt:'2026-07-01T00:00:00Z'}]});const p=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-stale1');x.setRows([{id:'p1',status:'LOST',createdAt:'x'},{id:'p2',status:'DEAL',createdAt:'x'}]);const r=await x.service.confirm('s1',p.id);assert.equal(r.status,'FAILED');assert.equal(x.calls.length,0);assert.deepEqual(x.db.prepare('SELECT status FROM bulk_not_deal_items ORDER BY ordinal').all().map(x=>x.status),['STALE','STALE','STALE']);
});

test('reject eksplisit FAILED; transport timeout schema UNKNOWN; tidak retry dan tidak simpan raw error',async()=>{
 let n=0;const x=fixture({prospects:[1,2,3].map(i=>({id:`p${i}`,status:'HOT',createdAt:'2026-07-01T00:00:00Z'})),update:async(_t,p)=>{n++;throw Object.assign(new Error('PII secret customer'),{code:p.prospectId==='p1'?'ASSIST_MUTATION_REJECTED':p.prospectId==='p2'?'ASSIST_TIMEOUT':'ASSIST_RESPONSE_INVALID'})}});const p=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-errors');const r=await x.service.confirm('s1',p.id);assert.equal(r.status,'FAILED');assert.equal(n,3);assert.deepEqual(x.db.prepare('SELECT status FROM bulk_not_deal_items ORDER BY ordinal').all().map(x=>x.status),['FAILED','UNKNOWN','UNKNOWN']);await x.service.run(p.id);assert.equal(n,3);assert.doesNotMatch(JSON.stringify(x.db.prepare('SELECT * FROM bulk_not_deal_items').all()),/PII|secret|customer/);
});

test('cancel/get owner scoped, concurrency bounds, lifecycle stop scoped per Sales',async()=>{
 const x=fixture({prospects:[{id:'p1',status:'HOT',createdAt:'2026-07-01T00:00:00Z'}]});const a=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-cancel');await assert.rejects(()=>x.service.get('s2',a.id),e=>e.code==='NOT_FOUND');assert.equal((await x.service.cancel('s1',a.id)).status,'CANCELLED');
 const b=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-stop-1');x.service.suspend('s1');assert.equal((await x.service.confirm('s1',b.id)).status,'CONFIRMED');assert.equal(x.calls.length,0);
 const c=await x.service.preview('s2',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-stop-2');assert.equal((await x.service.confirm('s2',c.id)).status,'SUCCEEDED');await assert.rejects(()=>x.service.confirm('s2',c.id,{concurrency:4}),e=>e.code==='INVALID_CONCURRENCY');x.service.disconnect('s2');x.service.shutdown('s1');
});

test('startup RUNNING menjadi UNKNOWN dan recover hanya CONFIRMED',async()=>{
 const x=fixture({prospects:[{id:'p1',status:'HOT',createdAt:'2026-07-01T00:00:00Z'}]});const a=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-recov1'),b=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-recov2');x.db.prepare("UPDATE bulk_not_deal_operations SET status='CONFIRMED' WHERE id=?").run(a.id);x.db.prepare("UPDATE bulk_not_deal_items SET status='RUNNING' WHERE operation_id=?").run(a.id);const out=await x.service.startup();assert.equal(out.length,1);assert.equal(x.db.prepare('SELECT status FROM bulk_not_deal_items WHERE operation_id=?').get(a.id).status,'UNKNOWN');assert.equal((await x.service.get('s1',b.id)).status,'PREVIEW');
});

test('startup switch OFF tidak menjalankan CONFIRMED',async()=>{const x=fixture({prospects:[{id:'p1',status:'HOT',createdAt:'2026-07-01T00:00:00Z'}]}),p=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-off-01');x.db.prepare("UPDATE bulk_not_deal_operations SET status='CONFIRMED' WHERE id=?").run(p.id);const out=await x.service.startup({recoverConfirmed:false});assert.deepEqual(out,[]);assert.equal(x.calls.length,0);assert.equal((await x.service.get('s1',p.id)).status,'CONFIRMED')});

test('database tidak menyimpan token atau PII prospek',async()=>{const x=fixture({prospects:[{id:'safe-id',status:'HOT',createdAt:'2026-07-01T00:00:00Z',name:'Private Name',phone:'08123'}]});await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'bulk-pii-01');const dump=JSON.stringify(x.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'bulk_not_deal_%'").all())+JSON.stringify(x.db.prepare('SELECT * FROM bulk_not_deal_operations').all())+JSON.stringify(x.db.prepare('SELECT * FROM bulk_not_deal_items').all());assert.doesNotMatch(dump,/Private Name|08123|token-s1/)});

test('confirm per item hanya memutasi snapshot item terpilih',async()=>{const x=fixture({prospects:[{id:'p1',prospectNumber:'H704-PRS-1',name:'A',status:'LOW',createdAt:'2026-07-01Z'},{id:'p2',prospectNumber:'H704-PRS-2',name:'B',status:'LOW',createdAt:'2026-07-01Z'}]});const p=await x.service.preview('s1',{cutoffDate:'2026-08-01T00:00:00Z'},'item-action-1');const r=await x.service.confirmItem('s1',p.id,p.items[1].itemId);assert.equal(r.item.status,'SUCCEEDED');assert.equal(x.calls.length,1);assert.equal(x.calls[0].p.prospectId,'p2');assert.deepEqual(x.db.prepare('SELECT status FROM bulk_not_deal_items ORDER BY ordinal').all().map(x=>x.status),['PENDING','SUCCEEDED'])});
