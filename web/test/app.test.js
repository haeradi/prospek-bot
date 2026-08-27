const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

async function request(base, path, options={}) {
  const r=await fetch(base+path,{redirect:'manual',...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  const text=await r.text(); let body; try{body=JSON.parse(text)}catch{body=text}
  return {status:r.status,body,headers:r.headers};
}

let server,base,app;
const sales={fullName:'Sales Demo',email:'sales@example.invalid',phone:'081234567890',salesCode:'DEMO01',dealerCode:'H704',password:'StrongPassword!123'};
let fakeLoginRunner,runnerDelay;
test.beforeEach(async()=>{ runnerDelay=15;fakeLoginRunner=async({emit,signal})=>{emit({status:'MFA_REQUIRED',mfaNumber:'42'});await new Promise((resolve,reject)=>{const t=setTimeout(resolve,runnerDelay);signal.addEventListener('abort',()=>{clearTimeout(t);reject(Object.assign(new Error('aborted'),{name:'AbortError'}))},{once:true})});return{accessToken:'synthetic-worker-access-token',refreshToken:'synthetic-worker-refresh-token',subjectId:'worker-subject',displayName:'Sales Worker',email:'worker@example.invalid',expiresAt:'2030-01-01T00:00:00.000Z'}};app=createApp({dbPath:':memory:',adminEmail:'admin@example.invalid',adminPassword:'AdminPassword!123',assistMasterKey:Buffer.alloc(32,7).toString('base64'),assistLoginRunner:fakeLoginRunner,assistLoginTimeoutMs:500}); server=app.server; await new Promise(r=>server.listen(0,'127.0.0.1',r)); base=`http://127.0.0.1:${server.address().port}`; });
test.afterEach(async()=>{ await new Promise(r=>server.close(r)); await app.close(); });

test('registrasi sales selalu PENDING dan tidak dapat login sebelum approval',async()=>{
 const reg=await request(base,'/api/register',{method:'POST',body:JSON.stringify({fullName:'Sales Demo',email:'sales@example.invalid',phone:'081234567890',salesCode:'DEMO01',dealerCode:'H704',password:'StrongPassword!123'})});
 assert.equal(reg.status,201); assert.equal(reg.body.status,'PENDING');
 const login=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:'sales@example.invalid',password:'StrongPassword!123'})});
 assert.equal(login.status,403); assert.equal(login.body.code,'ACCOUNT_PENDING');
});

test('admin dapat approve lalu sales login dan hanya melihat dashboard sales',async()=>{
 await request(base,'/api/register',{method:'POST',body:JSON.stringify({fullName:'Sales Demo',email:'sales@example.invalid',phone:'081234567890',salesCode:'DEMO01',dealerCode:'H704',password:'StrongPassword!123'})});
 const al=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:'admin@example.invalid',password:'AdminPassword!123'})});
 assert.equal(al.status,200); const cookie=al.headers.get('set-cookie').split(';')[0];
 const users=await request(base,'/api/admin/users?status=PENDING',{headers:{cookie}}); assert.equal(users.status,200); assert.equal(users.body.users.length,1);
 const approved=await request(base,`/api/admin/users/${users.body.users[0].id}/approve`,{method:'POST',headers:{cookie,'x-csrf-token':al.body.csrfToken},body:'{}'}); assert.equal(approved.status,200);
 const sl=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:'sales@example.invalid',password:'StrongPassword!123'})}); assert.equal(sl.status,200); assert.equal(sl.body.user.role,'SALES');
 const salesCookie=sl.headers.get('set-cookie').split(';')[0];
 const denied=await request(base,'/api/admin/users',{headers:{cookie:salesCookie}}); assert.equal(denied.status,403);
 const me=await request(base,'/api/me',{headers:{cookie:salesCookie}}); assert.equal(me.status,200); assert.equal(me.body.user.status,'ACTIVE');
});

test('suspend mencabut seluruh session sales',async()=>{
 const user=app.services.users.create({fullName:'Sales Demo',email:'sales@example.invalid',phone:'081234567890',salesCode:'DEMO01',dealerCode:'H704',password:'StrongPassword!123',status:'ACTIVE'});
 const sl=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:user.email,password:'StrongPassword!123'})}); const sc=sl.headers.get('set-cookie').split(';')[0];
 const al=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:'admin@example.invalid',password:'AdminPassword!123'})}); const ac=al.headers.get('set-cookie').split(';')[0];
 const suspended=await request(base,`/api/admin/users/${user.id}/suspend`,{method:'POST',headers:{cookie:ac,'x-csrf-token':al.body.csrfToken},body:'{}'}); assert.equal(suspended.status,200);
 const me=await request(base,'/api/me',{headers:{cookie:sc}}); assert.equal(me.status,401);
});

test('state-changing admin endpoint menolak CSRF yang hilang',async()=>{
 const al=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:'admin@example.invalid',password:'AdminPassword!123'})}); const cookie=al.headers.get('set-cookie').split(';')[0];
 const r=await request(base,'/api/admin/users/unknown/approve',{method:'POST',headers:{cookie},body:'{}'}); assert.equal(r.status,403); assert.equal(r.body.code,'CSRF_INVALID');
});

test('registrasi publik mengabaikan eskalasi role dan status',async()=>{
 const r=await request(base,'/api/register',{method:'POST',body:JSON.stringify({...sales,email:'attacker@example.invalid',phone:'081299999998',salesCode:'ATTACK',role:'ADMIN',status:'ACTIVE'})});
 assert.equal(r.status,201); assert.equal(r.body.status,'PENDING');
 const login=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:'attacker@example.invalid',password:sales.password})}); assert.equal(login.status,403);
});

test('mutasi admin melalui GET ditolak dan tidak mengubah akun',async()=>{
 const victim=app.services.users.create({...sales,email:'victim@example.invalid',phone:'081299999997',salesCode:'VICTIM'});
 const al=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:'admin@example.invalid',password:'AdminPassword!123'})}); const cookie=al.headers.get('set-cookie').split(';')[0];
 const r=await request(base,`/api/admin/users/${victim.id}/approve`,{headers:{cookie}}); assert.equal(r.status,404);
 const pending=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:'victim@example.invalid',password:sales.password})}); assert.equal(pending.status,403);
});

test('prospek terisolasi per sales dan sales lain tidak dapat mengubahnya',async()=>{
 const s1=app.services.users.create({...sales,email:'sales1@example.invalid',phone:'081211111111',salesCode:'SALE01',status:'ACTIVE'});
 const s2=app.services.users.create({...sales,email:'sales2@example.invalid',phone:'081222222222',salesCode:'SALE02',status:'ACTIVE'});
 const l1=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:s1.email,password:sales.password})}); const c1=l1.headers.get('set-cookie').split(';')[0];
 const l2=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:s2.email,password:sales.password})}); const c2=l2.headers.get('set-cookie').split(';')[0];
 const made=await request(base,'/api/prospects',{method:'POST',headers:{cookie:c1,'x-csrf-token':l1.body.csrfToken},body:JSON.stringify({customerName:'Customer Sintetis',phone:'081355555555',level:'HOT',motor:'PCX 160',province:'Kalimantan Timur',district:'Penajam Paser Utara',subDistrict:'Penajam',village:'Nenang'})});
 assert.equal(made.status,201); assert.equal(made.body.prospect.status,'DRAFT');
 const own=await request(base,'/api/prospects',{headers:{cookie:c1}}); assert.equal(own.body.prospects.length,1);
 const other=await request(base,'/api/prospects',{headers:{cookie:c2}}); assert.equal(other.body.prospects.length,0);
 const stolen=await request(base,`/api/prospects/${made.body.prospect.id}`,{method:'PATCH',headers:{cookie:c2,'x-csrf-token':l2.body.csrfToken},body:JSON.stringify({level:'LOW'})}); assert.equal(stolen.status,404);
});

test('sales tidak dapat membuat prospek tanpa CSRF atau dengan data tidak valid',async()=>{
 const s=app.services.users.create({...sales,email:'sales3@example.invalid',phone:'081233333333',salesCode:'SALE03',status:'ACTIVE'});
 const l=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:s.email,password:sales.password})}); const c=l.headers.get('set-cookie').split(';')[0];
 const noCsrf=await request(base,'/api/prospects',{method:'POST',headers:{cookie:c},body:JSON.stringify({customerName:'Customer Uji'})}); assert.equal(noCsrf.status,403);
 const invalid=await request(base,'/api/prospects',{method:'POST',headers:{cookie:c,'x-csrf-token':l.body.csrfToken},body:JSON.stringify({customerName:'X',phone:'abc',level:'SUPER HOT'})}); assert.equal(invalid.status,400);
});

test('halaman publik mengirim security headers produksi',async()=>{
 const r=await fetch(base+'/');assert.equal(r.status,200);assert.equal(r.headers.get('x-frame-options'),'DENY');assert.match(r.headers.get('content-security-policy'),/default-src 'self'/);assert.equal(r.headers.get('strict-transport-security'),'max-age=31536000; includeSubDomains');
});

test('hanya admin dapat membaca audit log yang tidak mengandung secret',async()=>{
 const s=app.services.users.create({...sales,email:'audit.sales@example.invalid',phone:'081244444444',salesCode:'AUDIT1',status:'ACTIVE'});
 const sl=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:s.email,password:sales.password})});const sc=sl.headers.get('set-cookie').split(';')[0];
 const denied=await request(base,'/api/admin/audit',{headers:{cookie:sc}});assert.equal(denied.status,403);
 const al=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:'admin@example.invalid',password:'AdminPassword!123'})});const ac=al.headers.get('set-cookie').split(';')[0];
 const audit=await request(base,'/api/admin/audit',{headers:{cookie:ac}});assert.equal(audit.status,200);assert.ok(audit.body.logs.some(x=>x.action==='LOGIN'));
 const serialized=JSON.stringify(audit.body);assert.equal(serialized.includes('Password'),false);assert.equal(serialized.includes('id_hash'),false);assert.equal(serialized.includes('csrf'),false);
});

test('vault ASSIST terenkripsi, terisolasi per Sales, dan token tidak keluar API',async()=>{
 const s1=app.services.users.create({...sales,email:'assist1@example.invalid',phone:'081233333331',salesCode:'AST01',status:'ACTIVE'});
 const s2=app.services.users.create({...sales,email:'assist2@example.invalid',phone:'081233333332',salesCode:'AST02',status:'ACTIVE'});
 const secret='synthetic-access-token-never-returned';app.services.assist.store(s1.id,{accessToken:secret,refreshToken:'synthetic-refresh-token',subjectId:'subject-1',displayName:'Sales Assist 1',email:'assist1@example.invalid',expiresAt:'2030-01-01T00:00:00.000Z'});
 const raw=app.db.prepare('SELECT * FROM assist_connections WHERE user_id=?').get(s1.id);assert.equal(JSON.stringify(raw).includes(secret),false);assert.notEqual(raw.access_ciphertext,secret);
 const l1=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:s1.email,password:sales.password})});const c1=l1.headers.get('set-cookie').split(';')[0];
 const own=await request(base,'/api/assist/connection',{headers:{cookie:c1}});assert.equal(own.status,200);assert.equal(own.body.connection.displayName,'Sales Assist 1');assert.equal(JSON.stringify(own.body).includes(secret),false);
 const l2=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:s2.email,password:sales.password})});const c2=l2.headers.get('set-cookie').split(';')[0];
 const other=await request(base,'/api/assist/connection',{headers:{cookie:c2}});assert.equal(other.status,200);assert.equal(other.body.connection,null);
 const noCsrf=await request(base,'/api/assist/connection',{method:'DELETE',headers:{cookie:c1},body:'{}'});assert.equal(noCsrf.status,403);
 const disconnected=await request(base,'/api/assist/connection',{method:'DELETE',headers:{cookie:c1,'x-csrf-token':l1.body.csrfToken},body:'{}'});assert.equal(disconnected.status,200);
 assert.equal(app.db.prepare('SELECT count(*) n FROM assist_connections WHERE user_id=?').get(s1.id).n,0);
});

test('login job ASSIST bounded, owner-only, dan success langsung masuk vault',async()=>{
 const s1=app.services.users.create({...sales,email:'job1@example.invalid',phone:'081222222221',salesCode:'JOB01',status:'ACTIVE'}),s2=app.services.users.create({...sales,email:'job2@example.invalid',phone:'081222222222',salesCode:'JOB02',status:'ACTIVE'});
 const l1=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:s1.email,password:sales.password})}),c1=l1.headers.get('set-cookie').split(';')[0];
 const started=await request(base,'/api/assist/login-jobs',{method:'POST',headers:{cookie:c1,'x-csrf-token':l1.body.csrfToken},body:JSON.stringify({username:'worker@example.invalid',password:'SyntheticAssistPassword!123'})});assert.equal(started.status,202);assert.ok(started.body.job.id);assert.equal(JSON.stringify(started.body).includes('SyntheticAssistPassword'),false);
 const duplicate=await request(base,'/api/assist/login-jobs',{method:'POST',headers:{cookie:c1,'x-csrf-token':l1.body.csrfToken},body:JSON.stringify({username:'worker@example.invalid',password:'SyntheticAssistPassword!123'})});assert.equal(duplicate.status,409);
 const l2=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:s2.email,password:sales.password})}),c2=l2.headers.get('set-cookie').split(';')[0];
 const foreign=await request(base,`/api/assist/login-jobs/${started.body.job.id}`,{headers:{cookie:c2}});assert.equal(foreign.status,404);
 await new Promise(r=>setTimeout(r,40));const done=await request(base,`/api/assist/login-jobs/${started.body.job.id}`,{headers:{cookie:c1}});assert.equal(done.status,200);assert.equal(done.body.job.status,'SUCCEEDED');assert.equal(JSON.stringify(done.body).includes('synthetic-worker-access-token'),false);assert.equal(JSON.stringify(done.body).includes('SyntheticAssistPassword'),false);
 const rawJob=app.db.prepare('SELECT * FROM login_jobs WHERE id=?').get(started.body.job.id);assert.equal(JSON.stringify(rawJob).includes('SyntheticAssistPassword'),false);assert.equal(JSON.stringify(rawJob).includes('synthetic-worker-access-token'),false);
 const conn=app.db.prepare('SELECT * FROM assist_connections WHERE user_id=?').get(s1.id);assert.ok(conn);assert.equal(JSON.stringify(conn).includes('synthetic-worker-access-token'),false);
});

test('request login ASSIST paralel hanya membuat satu job aktif per Sales',async()=>{
 const u=app.services.users.create({...sales,email:'race@example.invalid',phone:'081222222229',salesCode:'RACE01',status:'ACTIVE'}),login=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:u.email,password:sales.password})}),cookie=login.headers.get('set-cookie').split(';')[0],opt={method:'POST',headers:{cookie,'x-csrf-token':login.body.csrfToken},body:JSON.stringify({username:'race@example.invalid',password:'SyntheticAssistPassword!123'})};
 const payload=opt.body,start=()=>{let release;const done=new Promise((resolve,reject)=>{const url=new URL(base),req=require('node:http').request({hostname:url.hostname,port:url.port,path:'/api/assist/login-jobs',method:'POST',headers:{cookie,'x-csrf-token':login.body.csrfToken,'content-type':'application/json','content-length':Buffer.byteLength(payload)}},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(s)}))});req.on('error',reject);req.flushHeaders();release=()=>req.end(payload)});return{done,release}},a=start(),b=start();await new Promise(r=>setTimeout(r,20));a.release();b.release();const responses=await Promise.all([a.done,b.done]);assert.deepEqual(responses.map(x=>x.status).sort(),[202,409]);assert.equal(app.db.prepare("SELECT count(*) n FROM login_jobs WHERE user_id=? AND status IN ('QUEUED','RUNNING','MFA_REQUIRED')").get(u.id).n,1);
});

test('suspend saat body login ASSIST belum selesai mencegah worker diluncurkan',async()=>{
 runnerDelay=300;const u=app.services.users.create({...sales,email:'reserve@example.invalid',phone:'081222222228',salesCode:'RSV001',status:'ACTIVE'}),sl=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:u.email,password:sales.password})}),cookie=sl.headers.get('set-cookie').split(';')[0],payload=JSON.stringify({username:u.email,password:'AssistPassword!123'}),url=new URL(base);let release;const pending=new Promise((resolve,reject)=>{const req=require('node:http').request({hostname:url.hostname,port:url.port,path:'/api/assist/login-jobs',method:'POST',headers:{cookie,'x-csrf-token':sl.body.csrfToken,'content-type':'application/json','content-length':Buffer.byteLength(payload)}},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(s)}))});req.on('error',reject);req.write(payload.slice(0,5));release=()=>req.end(payload.slice(5))});await new Promise(r=>setTimeout(r,20));const al=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:'admin@example.invalid',password:'AdminPassword!123'})}),ac=al.headers.get('set-cookie').split(';')[0];await request(base,`/api/admin/users/${u.id}/suspend`,{method:'POST',headers:{cookie:ac,'x-csrf-token':al.body.csrfToken},body:'{}'});release();const r=await pending;assert.equal(r.status,409);assert.equal(r.body.code,'AUTH_REVOKED');assert.equal(app.db.prepare('SELECT count(*) n FROM login_jobs WHERE user_id=?').get(u.id).n,0);
});

test('kapasitas global login ASSIST dibatasi dua job',async()=>{
 runnerDelay=300;const starts=[];for(let i=1;i<=3;i++){const u=app.services.users.create({...sales,email:`cap${i}@example.invalid`,phone:`08122222223${i}`,salesCode:`CAP0${i}`,status:'ACTIVE'}),l=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:u.email,password:sales.password})}),c=l.headers.get('set-cookie').split(';')[0];starts.push(request(base,'/api/assist/login-jobs',{method:'POST',headers:{cookie:c,'x-csrf-token':l.body.csrfToken},body:JSON.stringify({username:u.email,password:'AssistPassword!123'})}))}const rs=await Promise.all(starts);assert.deepEqual(rs.map(x=>x.status).sort(),[202,202,503]);
});

test('suspend membatalkan login ASSIST dan mencegah vault ditulis',async()=>{
 runnerDelay=300;app.services.users.create({...sales,status:'ACTIVE'});const sl=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:sales.email,password:sales.password})}),sc=sl.headers.get('set-cookie').split(';')[0],start=await request(base,'/api/assist/login-jobs',{method:'POST',headers:{cookie:sc,'x-csrf-token':sl.body.csrfToken},body:JSON.stringify({username:sales.email,password:'AssistPassword!123'})});const al=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:'admin@example.invalid',password:'AdminPassword!123'})}),ac=al.headers.get('set-cookie').split(';')[0],u=app.db.prepare('SELECT id FROM users WHERE email=?').get(sales.email);await request(base,`/api/admin/users/${u.id}/suspend`,{method:'POST',headers:{cookie:ac,'x-csrf-token':al.body.csrfToken},body:'{}'});await new Promise(r=>setTimeout(r,20));assert.equal(app.db.prepare('SELECT count(*) n FROM assist_connections WHERE user_id=?').get(u.id).n,0);assert.notEqual(app.db.prepare('SELECT status FROM login_jobs WHERE id=?').get(start.body.job.id).status,'SUCCEEDED');
});

test('login dibatasi setelah percobaan gagal berulang',async()=>{
 for(let i=0;i<5;i++){const r=await request(base,'/api/login',{method:'POST',headers:{'x-forwarded-for':'198.51.100.9'},body:JSON.stringify({email:'unknown@example.invalid',password:'WrongPassword!123'})});assert.equal(r.status,401)}
 const blocked=await request(base,'/api/login',{method:'POST',headers:{'x-forwarded-for':'198.51.100.9'},body:JSON.stringify({email:'unknown@example.invalid',password:'WrongPassword!123'})});assert.equal(blocked.status,429);assert.equal(blocked.body.code,'RATE_LIMITED');
});

test('logout session aktif memerlukan CSRF dan mencabut session',async()=>{
 const al=await request(base,'/api/login',{method:'POST',body:JSON.stringify({email:'admin@example.invalid',password:'AdminPassword!123'})}); const cookie=al.headers.get('set-cookie').split(';')[0];
 const denied=await request(base,'/api/logout',{method:'POST',headers:{cookie},body:'{}'}); assert.equal(denied.status,403);
 const ok=await request(base,'/api/logout',{method:'POST',headers:{cookie,'x-csrf-token':al.body.csrfToken},body:'{}'}); assert.equal(ok.status,200);
 const me=await request(base,'/api/me',{headers:{cookie}}); assert.equal(me.status,401);
});
