'use strict';

const ENDPOINT='https://api.star.astra.co.id/graphql/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVITIES=`query ActivityRead { getAttendanceValidationFromActivity { assignmentActivityId activityIdForNotif activityType activityName } }`;
const STAFF=`query ActivityStaff($aid: UUID!) { getListStaffDetailActivityFromActivity(activityId: $aid) { staffId name lastClockIn lastClockOut } }`;
function failure(code,status=502){return Object.assign(new Error(code),{code,status})}
function cleanString(value,max=500){return typeof value==='string'&&value.length<=max?value.trim():null}
function parseActivityTime(value){
 if(typeof value!=='string'||!value)return null;
 const d=value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d{1,3})?)S)?$/);
 if(d&&(d[1]||d[2]||d[3])){const h=Number(d[1]||0),m=Number(d[2]||0),s=Number(d[3]||0);if(m>59||s>=60||!Number.isSafeInteger(h)||h>100000)return null;const milliseconds=(h*3600+m*60+s)*1000;if(!Number.isSafeInteger(milliseconds))return null;const whole=Math.floor(s),ms=Math.round((s-whole)*1000);return {kind:'duration',iso:value,milliseconds,time:`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(whole).padStart(2,'0')}.${String(ms).padStart(3,'0')}`}}
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const epochMs=Date.parse(value);if(!Number.isSafeInteger(epochMs))return null;const date=new Date(epochMs),parts=value.slice(0,10).split('-').map(Number);if(value.endsWith('Z')&&(date.getUTCFullYear()!==parts[0]||date.getUTCMonth()+1!==parts[1]||date.getUTCDate()!==parts[2]))return null;return {kind:'timestamp',iso:date.toISOString(),epochMs};
}
async function readLimited(response,limit){
 const declared=Number(response.headers?.get?.('content-length'));if(Number.isFinite(declared)&&declared>limit)throw failure('ASSIST_RESPONSE_TOO_LARGE');
 if(!response.body?.getReader){const text=await response.text();if(Buffer.byteLength(text)>limit)throw failure('ASSIST_RESPONSE_TOO_LARGE');return text}
 const reader=response.body.getReader(),parts=[];let size=0;try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>limit){await reader.cancel();throw failure('ASSIST_RESPONSE_TOO_LARGE')}parts.push(Buffer.from(chunk.value))}}finally{reader.releaseLock()}return Buffer.concat(parts).toString('utf8');
}
function makeDefaultTransport(maxResponseBytes){return async({token,query,variables,signal})=>{try{const response=await fetch(ENDPOINT,{method:'POST',signal,headers:{authorization:`Bearer ${token}`,'content-type':'application/json; charset=utf-8'},body:JSON.stringify({query,variables})});const text=await readLimited(response,maxResponseBytes);if(!response.ok)throw failure([401,403].includes(response.status)?'ASSIST_REAUTH_REQUIRED':'ASSIST_UPSTREAM_ERROR',[401,403].includes(response.status)?409:502);try{return JSON.parse(text)}catch{throw failure('ASSIST_RESPONSE_INVALID')}}catch(e){if(e.code)throw e;if(e.name==='AbortError')throw e;throw failure('ASSIST_UNAVAILABLE',503)}}}
function createAssistActivityClient({transport,timeoutMs=15000,maxResponseBytes=1024*1024,maxActivities=100,maxStaffPerActivity=500,concurrency=4}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000||!Number.isInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>8*1024*1024||!Number.isInteger(maxActivities)||maxActivities<1||maxActivities>500||!Number.isInteger(maxStaffPerActivity)||maxStaffPerActivity<1||maxStaffPerActivity>2000||!Number.isInteger(concurrency)||concurrency<1||concurrency>16)throw new TypeError('Invalid activity client limits');
 const send=transport||makeDefaultTransport(maxResponseBytes);
 async function listActivities(token,{signal:external}={}){
  if(typeof token!=='string'||!token)throw failure('ASSIST_REAUTH_REQUIRED',409);if(external?.aborted)throw failure('ASSIST_ABORTED',499);
  const controller=new AbortController(),onAbort=()=>controller.abort(),timer=setTimeout(()=>controller.abort(),timeoutMs);external?.addEventListener('abort',onAbort,{once:true});
  const request=async(query,variables)=>{let body;try{body=await send({token,query,variables,signal:controller.signal})}catch(e){if(e.name==='AbortError')throw failure(external?.aborted?'ASSIST_ABORTED':'ASSIST_TIMEOUT',external?.aborted?499:504);if(e.code)throw e;throw failure('ASSIST_UNAVAILABLE',503)}if(body?.errors?.length){const auth=/unauth|forbidden|jwt|token|expired|bearer/i.test(JSON.stringify(body.errors));throw failure(auth?'ASSIST_REAUTH_REQUIRED':'ASSIST_UPSTREAM_ERROR',auth?409:502)}return body};
  try{
   const body=await request(ACTIVITIES,undefined),raw=body?.data?.getAttendanceValidationFromActivity;if(!Array.isArray(raw))throw failure('ASSIST_RESPONSE_INVALID');if(raw.length>maxActivities)throw failure('ASSIST_RESPONSE_TOO_LARGE');
   const seen=new Set(),activities=[];for(const x of raw){if(activities.length>=maxActivities)break;const assignment=cleanString(x?.assignmentActivityId,200),id=cleanString(x?.activityIdForNotif,36),type=cleanString(x?.activityType,100),name=cleanString(x?.activityName,500);if(!assignment||!UUID.test(id||'')||!type||!name)throw failure('ASSIST_RESPONSE_INVALID');if(seen.has(assignment)||seen.has(`id:${id}`))continue;seen.add(assignment);seen.add(`id:${id}`);activities.push({assignmentActivityId:assignment,activityId:id,type,name,staff:[]})}
   let cursor=0;async function worker(){while(cursor<activities.length){const i=cursor++,a=activities[i],detail=await request(STAFF,{aid:a.activityId}),rows=detail?.data?.getListStaffDetailActivityFromActivity;if(!Array.isArray(rows))throw failure('ASSIST_RESPONSE_INVALID');if(rows.length>maxStaffPerActivity)throw failure('ASSIST_RESPONSE_TOO_LARGE');const staffSeen=new Set();for(const x of rows){const id=cleanString(x?.staffId,200),name=cleanString(x?.name,500);if(!id||!name)throw failure('ASSIST_RESPONSE_INVALID');if(staffSeen.has(id))continue;staffSeen.add(id);const lastClockIn=x.lastClockIn==null?null:parseActivityTime(x.lastClockIn),lastClockOut=x.lastClockOut==null?null:parseActivityTime(x.lastClockOut);if((x.lastClockIn!=null&&!lastClockIn)||(x.lastClockOut!=null&&!lastClockOut))throw failure('ASSIST_RESPONSE_INVALID');a.staff.push({id,name,lastClockIn,lastClockOut})}}}
   await Promise.all(Array.from({length:Math.min(concurrency,activities.length)},worker));return activities;
  }finally{clearTimeout(timer);external?.removeEventListener('abort',onAbort)}
 }
 return {listActivities};
}
module.exports={createAssistActivityClient,parseActivityTime};
