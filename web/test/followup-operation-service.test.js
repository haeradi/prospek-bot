'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {installFollowupOperationService}=require('../src/followup-operation-service');

function fixture({leads=[{assignmentId:'l1'},{assignmentId:'l2'}],prospects=[{id:'p1'},{id:'p2'}],followLead,followProspect,tokenFor}={}){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,status TEXT);');db.prepare('INSERT INTO users VALUES(?,?,?)').run('sales','SALES','ACTIVE');db.prepare('INSERT INTO users VALUES(?,?,?)').run('admin','ADMIN','ACTIVE');
 const calls=[];let currentLeads=leads,currentProspects=prospects;
 const service=installFollowupOperationService({db,tokenFor:tokenFor||(()=> 'token'),readClient:{listLeads:async()=>currentLeads,listProspects:async()=>currentProspects},followupClient:{followupLead:followLead|| (async(_t,p)=>{calls.push(['LEAD',p]);return{ok:true}}),followupProspect:followProspect|| (async(_t,p)=>{calls.push(['PROSPECT',p]);return{id:'f1'}})},now:()=> '2026-08-28T00:00:00.000Z'});
 return{db,service,calls,setLeads:v=>currentLeads=v,setProspects:v=>currentProspects=v};
}

test('preview LEAD mengambil snapshot ID authoritative, persisten, owner SALES, idempotent',async()=>{
 const x=fixture();const a=await x.service.preview('sales',{kind:'LEAD',leadType:'NEW'},'idem-key-123'),b=await x.service.preview('sales',{kind:'LEAD',leadType:'NEW'},'idem-key-123');
 assert.equal(a.id,b.id);assert.equal(a.status,'PREVIEW');assert.equal(a.total,2);assert.deepEqual(x.db.prepare('SELECT target_id FROM followup_operation_items ORDER BY ordinal').all().map(x=>x.target_id),['l1','l2']);assert.equal(x.calls.length,0);
 await assert.rejects(()=>x.service.preview('admin',{kind:'LEAD',leadType:'NEW'},'admin-key-123'),e=>e.code==='FORBIDDEN');
 await assert.rejects(()=>x.service.preview('sales',{kind:'PROSPECT',result:'HOT',description:'x',date:'2026-08-28T00:00:00Z'},'idem-key-123'),e=>e.code==='IDEMPOTENCY_CONFLICT');
});

test('preview PROSPECT membatasi 100 dan tidak menerima target IDs client',async()=>{
 const x=fixture({prospects:Array.from({length:101},(_,i)=>({id:`p${i}`}))});
 await assert.rejects(()=>x.service.preview('sales',{kind:'PROSPECT',result:'HOT',date:'2026-08-28T00:00:00Z'},'pros-key-123'),e=>e.code==='TOO_MANY_ITEMS');
 await assert.rejects(()=>x.service.preview('sales',{kind:'LEAD',leadType:'NEW',targetIds:['evil']},'ids-key-123'),e=>e.code==='TARGET_IDS_FORBIDDEN');
});

test('confirm menjalankan claim atomik dan tepat satu POST per item untuk LEAD',async()=>{
 const x=fixture(),p=await x.service.preview('sales',{kind:'LEAD',leadType:'NEW'},'run-key-123');const [a,b]=await Promise.all([x.service.confirm('sales',p.id,{concurrency:3}),x.service.confirm('sales',p.id,{concurrency:3})]);
 assert.equal(a.status,'SUCCEEDED');assert.equal(b.status,'SUCCEEDED');assert.equal(x.calls.length,2);assert.deepEqual(x.calls.map(c=>c[1].assignmentId).sort(),['l1','l2']);
});

test('PROSPECT revalidasi token/user dan existence tepat sebelum setiap POST; hilang menjadi STALE',async()=>{
 const x=fixture(),p=await x.service.preview('sales',{kind:'PROSPECT',result:'MEDIUM',description:'ok',date:'2026-08-28T00:00:00Z'},'pros-run-123');x.setProspects([{id:'p1'}]);const r=await x.service.confirm('sales',p.id,{concurrency:1});
 assert.equal(r.status,'FAILED');assert.deepEqual(x.calls,[['PROSPECT',{prospectId:'p1',result:'MEDIUM',description:'ok',date:'2026-08-28T00:00:00.000Z'}]]);assert.deepEqual(x.db.prepare('SELECT status FROM followup_operation_items ORDER BY ordinal').all().map(x=>x.status),['SUCCEEDED','STALE']);
});

test('ambiguitas timeout/transport/schema menjadi UNKNOWN tanpa retry, reject eksplisit FAILED',async()=>{
 let n=0;const x=fixture({leads:[{assignmentId:'l1'},{assignmentId:'l2'}],followLead:async(_t,p)=>{n++;throw Object.assign(new Error('contains private upstream detail'),{code:p.assignmentId==='l1'?'ASSIST_TIMEOUT':'ASSIST_MUTATION_REJECTED'})}}),p=await x.service.preview('sales',{kind:'LEAD',leadType:'NEW'},'errors-key-1');const r=await x.service.confirm('sales',p.id);
 assert.equal(r.status,'FAILED');assert.deepEqual(x.db.prepare('SELECT status,error_code FROM followup_operation_items ORDER BY ordinal').all().map(x=>({...x})),[{status:'UNKNOWN',error_code:'UPSTREAM_AMBIGUOUS'},{status:'FAILED',error_code:'UPSTREAM_REJECTED'}]);assert.equal(n,2);await x.service.run(p.id);assert.equal(n,2);assert.doesNotMatch(JSON.stringify(x.db.prepare('SELECT * FROM followup_operation_items').all()),/private/);
});

test('cancel, external abort already-aborted, dan lifecycle hooks menghentikan item belum diklaim',async()=>{
 const x=fixture(),p=await x.service.preview('sales',{kind:'LEAD',leadType:'NEW'},'cancel-key-1');assert.equal((await x.service.cancel('sales',p.id)).status,'CANCELLED');assert.equal(x.calls.length,0);
 const q=await x.service.preview('sales',{kind:'LEAD',leadType:'NEW'},'abort-key-1'),c=new AbortController();c.abort();assert.equal((await x.service.confirm('sales',q.id,{signal:c.signal})).status,'CANCELLED');assert.equal(x.calls.length,0);
 assert.equal(typeof x.service.suspend,'function');assert.equal(typeof x.service.disconnect,'function');assert.equal(typeof x.service.shutdown,'function');x.service.suspend();
});

test('startup RUNNING=>UNKNOWN dan memulihkan hanya CONFIRMED',async()=>{
 const x=fixture(),a=await x.service.preview('sales',{kind:'LEAD',leadType:'NEW'},'recover-key-1'),b=await x.service.preview('sales',{kind:'PROSPECT',result:'HOT',date:'2026-08-28T00:00:00Z'},'preview-key-1');
 x.db.prepare("UPDATE followup_operations SET status='CONFIRMED' WHERE id=?").run(a.id);x.db.prepare("UPDATE followup_operation_items SET status='RUNNING' WHERE operation_id=? AND ordinal=0").run(a.id);
 const recovered=await x.service.startup();assert.equal(recovered.length,1);assert.equal(x.db.prepare('SELECT status FROM followup_operation_items WHERE operation_id=? AND ordinal=0').get(a.id).status,'UNKNOWN');assert.equal((await x.service.get('sales',b.id)).status,'PREVIEW');
});

test('suspend scoped hanya menghentikan Sales target dan resume memulihkan',async()=>{const x=fixture();x.db.prepare("INSERT INTO users VALUES('sales2','SALES','ACTIVE')").run();x.service.suspend('sales');await assert.rejects(()=>x.service.preview('sales',{kind:'LEAD',leadType:'NEW'},'scope-stop-1'),e=>e.code==='ABORTED');const p=await x.service.preview('sales2',{kind:'LEAD',leadType:'NEW'},'scope-other-2');assert.equal(p.status,'PREVIEW');x.service.resume('sales');const q=await x.service.preview('sales',{kind:'LEAD',leadType:'NEW'},'scope-resume-3');assert.equal(q.status,'PREVIEW')});
test('startup switch OFF tidak menjalankan CONFIRMED',async()=>{const x=fixture(),p=await x.service.preview('sales',{kind:'LEAD',leadType:'NEW'},'startup-off-1');x.db.prepare("UPDATE followup_operations SET status='CONFIRMED' WHERE id=?").run(p.id);const out=await x.service.startup({recoverConfirmed:false});assert.deepEqual(out,[]);assert.equal(x.calls.length,0);assert.equal((await x.service.get('sales',p.id)).status,'CONFIRMED')});
test('concurrency hanya 1-3',async()=>{const x=fixture(),p=await x.service.preview('sales',{kind:'LEAD',leadType:'NEW'},'bounds-key-1');await assert.rejects(()=>x.service.confirm('sales',p.id,{concurrency:4}),e=>e.code==='INVALID_CONCURRENCY')});

test.afterEach(()=>{});
