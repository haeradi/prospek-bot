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
test.beforeEach(async()=>{ app=createApp({dbPath:':memory:',adminEmail:'admin@example.invalid',adminPassword:'AdminPassword!123'}); server=app.server; await new Promise(r=>server.listen(0,'127.0.0.1',r)); base=`http://127.0.0.1:${server.address().port}`; });
test.afterEach(async()=>{ await new Promise(r=>server.close(r)); app.close(); });

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
