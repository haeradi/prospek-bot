'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAssistActivityClient,parseActivityTime}=require('../src/assist-activity-client');

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const activities=(nodes)=>({data:{getAttendanceValidationFromActivity:nodes}});
const staff=(nodes)=>({data:{getListStaffDetailActivityFromActivity:nodes}});

test('membaca dua operasi authoritative, bearer dari caller, proyeksi ketat dan dedup stabil',async()=>{
 const calls=[];
 const client=createAssistActivityClient({transport:async req=>{calls.push(req);return req.variables?.aid?staff([{staffId:'s1',name:' Ani ',lastClockIn:'PT8H2M3.4S',lastClockOut:'2026-08-28T01:02:03Z',secret:'x'},{staffId:'s1',name:'dupe'}]):activities([{assignmentActivityId:'as1',activityIdForNotif:A,activityType:'BTL',activityName:'Event',extra:'x'},{assignmentActivityId:'as1',activityIdForNotif:A,activityType:'BTL',activityName:'dupe'}])}});
 const result=await client.listActivities('tenant-secret');
 assert.equal(calls.length,2);assert.ok(calls[0].query.includes('getAttendanceValidationFromActivity'));assert.ok(calls[1].query.includes('getListStaffDetailActivityFromActivity'));assert.equal(calls[1].variables.aid,A);assert.ok(calls.every(x=>x.token==='tenant-secret'));
 assert.deepEqual(result,[{assignmentActivityId:'as1',activityId:A,type:'BTL',name:'Event',staff:[{id:'s1',name:'Ani',lastClockIn:{kind:'duration',iso:'PT8H2M3.4S',milliseconds:28923400,time:'08:02:03.400'},lastClockOut:{kind:'timestamp',iso:'2026-08-28T01:02:03.000Z',epochMs:1787878923000}}]}]);
 assert.equal(JSON.stringify(result).includes('secret'),false);
});

test('membatasi aktivitas/staff dan concurrency detail',async()=>{
 let active=0,peak=0;
 const ids=[A,B,'33333333-3333-4333-8333-333333333333'];
 const client=createAssistActivityClient({maxActivities:2,maxStaffPerActivity:1,concurrency:2,transport:async req=>{
  if(!req.variables)return activities(ids.map((id,i)=>({assignmentActivityId:`a${i}`,activityIdForNotif:id,activityType:'POS',activityName:`N${i}`})));
  active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,15));active--;return staff([{staffId:`s-${req.variables.aid}`,name:'One'},{staffId:'second',name:'Two'}]);
 }});
 await assert.rejects(()=>client.listActivities('token'),e=>e.code==='ASSIST_RESPONSE_TOO_LARGE');assert.equal(peak,0);
 const staffCap=createAssistActivityClient({maxStaffPerActivity:1,transport:async req=>req.variables?staff([{staffId:'s1',name:'One'},{staffId:'s2',name:'Two'}]):activities([{assignmentActivityId:'a1',activityIdForNotif:A,activityType:'BTL',activityName:'N'}])});await assert.rejects(()=>staffCap.listActivities('token'),e=>e.code==='ASSIST_RESPONSE_TOO_LARGE');
});

test('menolak UUID/schema tidak valid dan menyanitasi error tanpa token',async()=>{
 const bad=createAssistActivityClient({transport:async()=>activities([{assignmentActivityId:'a',activityIdForNotif:'not-uuid',activityType:'BTL',activityName:'x'}])});
 await assert.rejects(()=>bad.listActivities('top-secret'),e=>e.code==='ASSIST_RESPONSE_INVALID'&&!e.message.includes('top-secret'));
 const upstream=createAssistActivityClient({transport:async()=>({errors:[{message:'Bearer top-secret stack'}]})});
 await assert.rejects(()=>upstream.listActivities('top-secret'),e=>e.code==='ASSIST_REAUTH_REQUIRED'&&!e.message.includes('top-secret'));
});

test('deadline total <=15 detik dan external abort termasuk already-aborted',async()=>{
 const transport=({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('leak token'),{name:'AbortError'})),{once:true}));
 assert.throws(()=>createAssistActivityClient({timeoutMs:15001}),TypeError);
 const client=createAssistActivityClient({timeoutMs:100,transport});
 await assert.rejects(()=>client.listActivities('secret'),e=>e.code==='ASSIST_TIMEOUT');
 const c=new AbortController();c.abort();
 await assert.rejects(()=>client.listActivities('secret',{signal:c.signal}),e=>e.code==='ASSIST_ABORTED');
});

test('parser waktu hanya menerima ISO duration/timestamp valid dan aman',()=>{
 assert.deepEqual(parseActivityTime('PT25H'),{kind:'duration',iso:'PT25H',milliseconds:90000000,time:'25:00:00.000'});
 assert.equal(parseActivityTime('2026-02-30T00:00:00Z'),null);assert.equal(parseActivityTime('garbage'),null);assert.equal(parseActivityTime(12),null);
});

test('default transport menghentikan response stream yang melewati cap',async t=>{
 const original=global.fetch;t.after(()=>{global.fetch=original});let cancelled=false;
 global.fetch=async()=>({ok:true,status:200,headers:{get:()=>null},body:{getReader:()=>({async read(){return {done:false,value:new Uint8Array(9)}} ,async cancel(){cancelled=true},releaseLock(){}})}});
 const client=createAssistActivityClient({maxResponseBytes:8,timeoutMs:100});
 await assert.rejects(()=>client.listActivities('never-echo-this'),e=>e.code==='ASSIST_RESPONSE_TOO_LARGE'&&!e.message.includes('never-echo-this'));
 assert.equal(cancelled,true);
});
