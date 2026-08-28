'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAssistFollowupClient}=require('../src/assist-followup-client');

test('follow-up lead mengirim kontrak CRM authoritative',async()=>{
 const calls=[],client=createAssistFollowupClient({transport:async x=>{calls.push(x);return{data:{ensureSaveFollowUpSalesmanFromCrm:true}}}}),result=await client.followupLead('token',{assignmentId:'assignment-1'});
 assert.deepEqual(result,{ok:true});assert.equal(calls.length,1);assert.deepEqual(calls[0].variables,{input:{activityLeadsAssignmentId:'assignment-1',followUpMethod:'WhatsApp Chat',followUpStatus:'Contacted',followUpStatusDesc:'Chat terkirim, dibalas',followUpResult:'Tidak Tertarik',followUpResultReason:'Ada keperluan lain',followUpNotes:'belum'}});assert.match(calls[0].query,/ensureSaveFollowUpSalesmanFromCrm/)
});

test('follow-up prospek mengirim kontrak Customers authoritative',async()=>{
 const calls=[],client=createAssistFollowupClient({transport:async x=>{calls.push(x);return{data:{ensureCreateFollowUpProspectFromCustomers:{id:'fu-1'}}}}}),result=await client.followupProspect('token',{prospectId:'prospect-1',result:'HOT',description:'Dihubungi',date:'2026-08-28T01:02:03.000Z'});
 assert.deepEqual(result,{id:'fu-1'});assert.deepEqual(calls[0].variables,{input:{customerProspectId:'prospect-1',followUpMethod:'WA',followUpResult:'HOT',description:'Dihubungi',followUpDate:'2026-08-28T01:02:03.000Z'}});assert.match(calls[0].query,/ensureCreateFollowUpProspectFromCustomers/)
});

test('follow-up lead fail-closed untuk input, schema, abort, dan error',async()=>{
 let calls=0;const client=createAssistFollowupClient({transport:async()=>{calls++;return{data:{ensureSaveFollowUpSalesmanFromCrm:null}}}});await assert.rejects(()=>client.followupLead('token',{assignmentId:''}),e=>e.code==='INVALID_LEAD');await assert.rejects(()=>client.followupLead('token',{assignmentId:'a1'}),e=>e.code==='ASSIST_RESPONSE_INVALID');const c=new AbortController();c.abort();await assert.rejects(()=>client.followupLead('token',{assignmentId:'a1'},{signal:c.signal}),e=>e.code==='ASSIST_TIMEOUT');assert.equal(calls,1)
});
