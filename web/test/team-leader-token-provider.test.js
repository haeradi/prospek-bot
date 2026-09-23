'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createUnixTokenProvider}=require('../src/team-leader-token-provider');

async function withBroker(reply,fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tl-token-')),socket=path.join(dir,'broker.sock');const server=net.createServer(c=>{let raw='';c.setEncoding('utf8');c.on('data',x=>raw+=x);c.on('end',()=>{const req=JSON.parse(raw);c.end(JSON.stringify(reply(req))+'\n')})});await new Promise((ok,bad)=>server.listen(socket,ok).once('error',bad));try{await fn(socket)}finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}}

test('mengambil token Abdul melalui Unix socket tanpa memasukkannya ke request',async()=>withBroker(req=>({ok:true,accessToken:'header.payload.signature'}),async socket=>{const provider=createUnixTokenProvider({socketPath:socket,expectedEmail:'abdul.rahmadan@hso.astra.co.id'});assert.equal(await provider({email:'abdul.rahmadan@hso.astra.co.id',role:'TEAMLEAD'}),'header.payload.signature')}));
test('menolak user/role lain sebelum menghubungi broker',async()=>withBroker(()=>({ok:true,accessToken:'secret'}),async socket=>{const provider=createUnixTokenProvider({socketPath:socket,expectedEmail:'abdul.rahmadan@hso.astra.co.id'});await assert.rejects(()=>provider({email:'x@example.invalid',role:'TEAMLEAD'}),e=>e.code==='TEAMLEADER_TOKEN_FORBIDDEN');await assert.rejects(()=>provider({email:'abdul.rahmadan@hso.astra.co.id',role:'SALES'}),e=>e.code==='TEAMLEADER_TOKEN_FORBIDDEN')}));
test('gagal tertutup pada respons broker invalid atau terlalu besar',async()=>withBroker(()=>({ok:true,accessToken:'x'.repeat(21000)}),async socket=>{const provider=createUnixTokenProvider({socketPath:socket,expectedEmail:'abdul.rahmadan@hso.astra.co.id'});await assert.rejects(()=>provider({email:'abdul.rahmadan@hso.astra.co.id',role:'TEAMLEAD'}),e=>e.code==='TEAMLEADER_TOKEN_UNAVAILABLE')}));
test('abort menghentikan penantian token broker',async()=>withBroker(()=>({ok:true,accessToken:'late-token'}),async socket=>{const provider=createUnixTokenProvider({socketPath:socket,expectedEmail:'abdul.rahmadan@hso.astra.co.id'}),controller=new AbortController();controller.abort();await assert.rejects(()=>provider({email:'abdul.rahmadan@hso.astra.co.id',role:'TEAMLEAD'},{signal:controller.signal}),e=>e.code==='TEAMLEADER_TOKEN_UNAVAILABLE')}));
