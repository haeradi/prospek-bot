'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTeamLeaderDashboardClient}=require('../src/team-leader-dashboard-client');

const TL='11111111-1111-1111-1111-111111111111';
const OTHER='22222222-2222-2222-2222-222222222222';
const identity={userRole:[{userId:TL,roleKey:'TEAMLEAD'}],staffId:'staff-1',isTeamLead:true,isSalesman:false,isBrancHead:false};
const daily=[{dayOfWeek:'Tuesday',day:1,prospect:9,target:440},{dayOfWeek:'Wednesday',day:2,prospect:97,target:440}];
const own={teamLeaderId:TL,teamLeaderName:'ABDUL RAHMADAN HAERADI',totalSalesman:2,totalProspect:106,target:440,achievement:24.09,salesmanContributions:[{salesmanId:'s1',salesmanName:'DESI NURULHIJA',totalProspect:20,target:40,achievement:50},{salesmanId:'s2',salesmanName:'SRI WAHYUNI',totalProspect:8,target:40,achievement:20}]};
const foreign={...own,teamLeaderId:OTHER,teamLeaderName:'SAMUEL YUDHA PANGESTU',salesmanContributions:[{salesmanId:'bad',salesmanName:'FOREIGN SALES',totalProspect:999,target:1,achievement:99900}]};

function transportFor({who=identity,teams=[foreign,own],days=daily}={}){const calls=[];return {calls,transport:async x=>{calls.push(x);if(x.query.includes('TeamLeaderIdentity'))return{data:{getUserInfoCustomModelFromActivity:who}};if(x.query.includes('TeamProspectDaily'))return{data:{getDailyChartProspectFromSalesTarget:days}};if(x.query.includes('TeamProspectContribution'))return{data:{getSalesTeamProspectContributionFromSalesTarget:teams}};throw new Error('unexpected query')}}}

test('dashboard memvalidasi identitas TEAMLEAD dan hanya memproyeksikan tim sendiri',async()=>{const fake=transportFor(),client=createTeamLeaderDashboardClient({transport:fake.transport});const result=await client.getDashboard('jwt',{month:9,year:2026,day:13});assert.equal(result.identity.userId,TL);assert.equal(result.team.teamLeaderName,'ABDUL RAHMADAN HAERADI');assert.deepEqual(result.team.sales.map(x=>x.name),['DESI NURULHIJA','SRI WAHYUNI']);assert.equal(JSON.stringify(result).includes('SAMUEL'),false);assert.equal(JSON.stringify(result).includes('FOREIGN SALES'),false);assert.deepEqual(result.daily.map(x=>x.prospect),[9,97]);assert.deepEqual(fake.calls.slice(1).map(x=>x.variables),[{input:{month:9,year:2026,branchHeadId:TL}},{input:{month:9,year:2026,branchHeadId:TL}}])});

test('dashboard menolak JWT yang bukan TEAMLEAD',async()=>{const fake=transportFor({who:{...identity,isTeamLead:false,userRole:[{userId:TL,roleKey:'SALES'}]}}),client=createTeamLeaderDashboardClient({transport:fake.transport});await assert.rejects(()=>client.getDashboard('jwt',{month:9,year:2026,day:13}),e=>e.code==='ASSIST_TEAMLEAD_REQUIRED'&&e.status===403);assert.equal(fake.calls.length,1)});

test('dashboard gagal tertutup jika tim sendiri hilang atau duplikat',async()=>{for(const teams of [[foreign],[own,{...own}]]){const fake=transportFor({teams}),client=createTeamLeaderDashboardClient({transport:fake.transport});await assert.rejects(()=>client.getDashboard('jwt',{month:9,year:2026,day:13}),e=>e.code==='ASSIST_TEAM_SCOPE_INVALID')}});

test('dashboard memvalidasi periode dan bentuk respons upstream',async()=>{const client=createTeamLeaderDashboardClient({transport:transportFor().transport});for(const period of [{month:0,year:2026,day:1},{month:13,year:2026,day:1},{month:9,year:1999,day:1},{month:9,year:2026,day:32}])await assert.rejects(()=>client.getDashboard('jwt',period),e=>e.code==='INVALID_PERIOD'&&e.status===400);const malformed=createTeamLeaderDashboardClient({transport:transportFor({days:[{day:1,prospect:'9',target:440}]}).transport});await assert.rejects(()=>malformed.getDashboard('jwt',{month:9,year:2026,day:13}),e=>e.code==='ASSIST_RESPONSE_INVALID')});

test('token tidak pernah keluar dari hasil',async()=>{const secret='secret-teamleader-jwt',client=createTeamLeaderDashboardClient({transport:transportFor().transport}),result=await client.getDashboard(secret,{month:9,year:2026,day:13});assert.equal(JSON.stringify(result).includes(secret),false)});

test('dashboard tidak memanggil upstream jika request sudah dibatalkan',async()=>{const fake=transportFor(),client=createTeamLeaderDashboardClient({transport:fake.transport}),controller=new AbortController();controller.abort();await assert.rejects(()=>client.getDashboard('jwt',{month:9,year:2026,day:13,signal:controller.signal}),e=>e.code==='ASSIST_TIMEOUT');assert.equal(fake.calls.length,0)});

test('deadline berlaku untuk seluruh rangkaian dashboard, bukan per operasi',async()=>{let calls=0;const transport=({signal})=>new Promise((resolve,reject)=>{calls++;if(calls===1)return setTimeout(()=>resolve({data:{getUserInfoCustomModelFromActivity:identity}}),70);signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true})}),client=createTeamLeaderDashboardClient({transport,timeoutMs:100}),started=Date.now();await assert.rejects(()=>client.getDashboard('jwt',{month:9,year:2026,day:13}),e=>e.code==='ASSIST_TIMEOUT');assert.ok(Date.now()-started<155);assert.equal(calls,3)});

test('periode menolak tanggal kalender yang mustahil',async()=>{const fake=transportFor(),client=createTeamLeaderDashboardClient({transport:fake.transport});await assert.rejects(()=>client.getDashboard('jwt',{month:2,year:2026,day:31}),e=>e.code==='INVALID_PERIOD');assert.equal(fake.calls.length,0)});

test('snapshot harian hanya mengembalikan data sampai tanggal pilihan',async()=>{const fake=transportFor(),client=createTeamLeaderDashboardClient({transport:fake.transport}),result=await client.getDashboard('jwt',{month:9,year:2026,day:1});assert.deepEqual(result.daily.map(x=>x.day),[1]);assert.deepEqual(fake.calls.slice(1).map(x=>x.variables),[{input:{month:9,year:2026,branchHeadId:TL}},{input:{month:9,year:2026,branchHeadId:TL}}])});
