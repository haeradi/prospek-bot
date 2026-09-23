'use strict';
const net=require('node:net'),fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process');
const portalGid=Number((fs.readFileSync('/etc/group','utf8').split('\n').find(x=>x.startsWith('prospekweb:'))||'::0:').split(':')[2]);
const socketPath=process.env.TEAMLEADER_TOKEN_SOCKET||'/run/prospek-web-token/broker.sock',email='abdul.rahmadan@hso.astra.co.id',vmid=process.env.TEAMLEADER_TOKEN_VMID||'200';
function respond(c,body){c.end(JSON.stringify(body)+'\n')}
let cachedToken=null,cachedUntil=0,tokenFetchWaiters=[];
function fetchToken(cb){
 if(cachedToken&&Date.now()<cachedUntil)return process.nextTick(cb,null,cachedToken);
 tokenFetchWaiters.push(cb);if(tokenFetchWaiters.length>1)return;
 const finish=(err,token)=>{if(!err){cachedToken=token;cachedUntil=Date.now()+5000}const waiters=tokenFetchWaiters;tokenFetchWaiters=[];for(const waiter of waiters)waiter(err,token)};
 execFile('/usr/sbin/qm',['guest','exec',vmid,'--','sudo','-u','ubuntu','node','/home/ubuntu/h704-bot/team-leader-token-export.mjs'],{timeout:10000,maxBuffer:65536,encoding:'utf8'},(err,stdout,stderr)=>{try{const outer=JSON.parse(stdout),inner=JSON.parse(String(outer['out-data']||'').trim());if(err||outer.exitcode!==0||inner.ok!==true||typeof inner.accessToken!=='string'||inner.accessToken.length>20000){console.warn('Token fetch unavailable',{exec:err?.code||null,outerExit:outer.exitcode??null,innerCode:inner.code||null});return finish(new Error('UNAVAILABLE'))}finish(null,inner.accessToken)}catch{console.warn('Token fetch response invalid',{exec:err?.code||null,stdoutLength:stdout?.length||0,stderr:String(stderr||'').replace(/[^A-Za-z0-9 _./:-]/g,'').slice(0,240)});finish(new Error('UNAVAILABLE'))}})
}
fs.mkdirSync(path.dirname(socketPath),{recursive:true,mode:0o750});fs.chownSync(path.dirname(socketPath),0,portalGid);fs.chmodSync(path.dirname(socketPath),0o750);try{fs.unlinkSync(socketPath)}catch(e){if(e.code!=='ENOENT')throw e}
const server=net.createServer({allowHalfOpen:true},c=>{c.setEncoding('utf8');c.setTimeout(3000);let raw='',size=0,done=false;const reject=()=>{if(done)return;done=true;respond(c,{ok:false,code:'TOKEN_UNAVAILABLE'})};c.on('data',x=>{size+=Buffer.byteLength(x);if(size>2048)return reject();raw+=x});c.on('timeout',reject);c.on('error',()=>{});c.on('end',()=>{if(done)return;let req;try{req=JSON.parse(raw.trim())}catch{return reject()}if(req?.version!==1||req?.purpose!=='team-leader-dashboard'||String(req?.account||'').toLowerCase()!==email)return reject();done=true;fetchToken((err,accessToken)=>respond(c,err?{ok:false,code:'TOKEN_UNAVAILABLE'}:{ok:true,accessToken}))})});
server.maxConnections=16;
server.listen(socketPath,()=>{fs.chownSync(socketPath,0,portalGid);fs.chmodSync(socketPath,0o660);console.log('Team Leader token broker ready')});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>process.exit(0)));
