'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAssistMutationClient}=require('../src/assist-mutation-client');

test('update status mengirim kontrak STAR yang tepat dan memproyeksikan hasil',async()=>{
 const calls=[],client=createAssistMutationClient({transport:async x=>{calls.push(x);return{data:{ensureUpdateCustomerProspectStatusFromCustomers:{id:'p1',prospectStatus:'DEAL'}}}}});
 const result=await client.updateProspectStatus('secret-token',{prospectId:'p1',toStatus:'DEAL',reason:'Update via Portal'});
 assert.deepEqual(result,{id:'p1',status:'DEAL'});assert.equal(calls.length,1);assert.deepEqual(calls[0].variables,{data:{customerProspectId:'p1',prospectStatus:'DEAL',reasonNotDeal:'Update via Portal'}});assert.match(calls[0].query,/ensureUpdateCustomerProspectStatusFromCustomers/);assert.equal(JSON.stringify(result).includes('secret-token'),false)
});

test('LOST Ada keperluan lain mengirim UUID reason authoritative',async()=>{
 const calls=[],client=createAssistMutationClient({transport:async x=>{calls.push(x);return{data:{ensureUpdateCustomerProspectStatusFromCustomers:{id:'p1',prospectStatus:'LOST'}}}}});
 await client.updateProspectStatus('secret-token',{prospectId:'p1',toStatus:'LOST',reason:'Ada keperluan lain'});
 assert.equal(calls[0].variables.data.reasonNotDeal,'b7b0c814-ef70-4068-b26f-abf73b03ec0b');
});

test('create prospek mengirim kontrak STAR authoritative dan memproyeksikan hasil',async()=>{
 const calls=[],client=createAssistMutationClient({transport:async x=>{calls.push(x);return{data:{ensureCreateCustomerProspectFromCustomers:{id:'new-p1',prospectNumber:'H704-PRS-9',created:'2026-08-28T00:00:00Z',prospectStatus:'PROSPECT'}}}}});
 const input={name:'Customer Baru',mobilePhoneNumber:'628123456789',customerType:'REGULAR',gender:'LAKI_LAKI',testRidePreference:false,tagPriority:true,preferenceSalesType:'CREDIT',prospectStatus:'PROSPECT',channelId:'channel-1',channelName:'ASTRA MOTOR PENAJAM',occupation:'Wiraswasta',religion:'ISLAM',sourceOfProspectHsoId:'source-1'};
 const result=await client.createProspect('secret-token',input);assert.deepEqual(result,{id:'new-p1',prospectNumber:'H704-PRS-9',created:'2026-08-28T00:00:00Z',status:'PROSPECT'});assert.equal(calls.length,1);assert.deepEqual(calls[0].variables,{data:input});assert.match(calls[0].query,/ensureCreateCustomerProspectFromCustomers/);assert.equal(JSON.stringify(result).includes('secret-token'),false)
});

test('mutation client menolak input, schema abnormal, dan GraphQL error dengan aman',async()=>{
 const client=createAssistMutationClient({transport:async()=>({data:{ensureUpdateCustomerProspectStatusFromCustomers:{id:'p1'}}})});
 await assert.rejects(()=>client.updateProspectStatus('',{prospectId:'p1',toStatus:'DEAL',reason:'abc'}),e=>e.code==='ASSIST_REAUTH_REQUIRED');
 await assert.rejects(()=>client.updateProspectStatus('t',{prospectId:'p1',toStatus:'DROP',reason:'abc'}),e=>e.code==='INVALID_STATUS_TRANSITION');
 await assert.rejects(()=>client.updateProspectStatus('t',{prospectId:'p1',toStatus:'DEAL',reason:'abc'}),e=>e.code==='ASSIST_RESPONSE_INVALID');
 const errored=createAssistMutationClient({transport:async()=>({errors:[{message:'Bearer secret-token internal'}]})});await assert.rejects(()=>errored.updateProspectStatus('secret-token',{prospectId:'p1',toStatus:'DEAL',reason:'abc'}),e=>e.code==='ASSIST_REAUTH_REQUIRED'&&!e.message.includes('secret-token'))
});

test('mutation client meneruskan abort dan menerapkan deadline total',async()=>{
 const transport=({signal})=>new Promise((resolve,reject)=>{const t=setTimeout(resolve,500);signal.addEventListener('abort',()=>{clearTimeout(t);reject(Object.assign(new Error('aborted'),{name:'AbortError'}))},{once:true})}),client=createAssistMutationClient({transport,timeoutMs:100});
 await assert.rejects(()=>client.updateProspectStatus('t',{prospectId:'p1',toStatus:'DEAL',reason:'abc'}),e=>e.code==='ASSIST_TIMEOUT');const c=new AbortController(),p=client.updateProspectStatus('t',{prospectId:'p1',toStatus:'DEAL',reason:'abc'},{signal:c.signal});c.abort();await assert.rejects(()=>p,e=>e.code==='ASSIST_TIMEOUT');let calls=0;const never=createAssistMutationClient({transport:async()=>{calls++;return{};}}),already=new AbortController();already.abort();await assert.rejects(()=>never.updateProspectStatus('t',{prospectId:'p1',toStatus:'DEAL',reason:'abc'},{signal:already.signal}),e=>e.code==='ASSIST_TIMEOUT');assert.equal(calls,0)
});
