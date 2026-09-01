'use strict';
const crypto=require('node:crypto');
const fail=(code,status=409)=>Object.assign(new Error(code),{code,status});
function installProspectDeleteExcelDraftsService({db,now=()=>new Date().toISOString(),audit=()=>{}}){
 db.exec(`CREATE TABLE IF NOT EXISTS prospect_excel_draft_delete_operations(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,preview_count INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
 const columns=db.prepare('PRAGMA table_info(prospect_excel_draft_delete_operations)').all().map(x=>x.name);
 if(!columns.includes('snapshot_ids'))db.exec('ALTER TABLE prospect_excel_draft_delete_operations ADD COLUMN snapshot_ids TEXT');
 const eligibleIds=owner=>db.prepare("SELECT id FROM prospects WHERE owner_id=? AND input_origin='EXCEL' AND status='DRAFT' ORDER BY id").all(owner).map(x=>x.id);
 function active(owner){const u=db.prepare('SELECT role,status FROM users WHERE id=?').get(owner);if(!u||u.role!=='SALES'||u.status!=='ACTIVE')throw fail('FORBIDDEN',403)}
 function owned(owner,id){const op=db.prepare('SELECT * FROM prospect_excel_draft_delete_operations WHERE id=? AND owner_id=?').get(id,owner);if(!op)throw fail('NOT_FOUND',404);return op}
 function view(op){return{id:op.id,count:op.preview_count,status:op.status,deleted:op.status==='CONFIRMED'?op.preview_count:0}}
 function preview(owner){active(owner);const id=crypto.randomUUID(),ids=eligibleIds(owner),t=now();db.prepare('INSERT INTO prospect_excel_draft_delete_operations(id,owner_id,preview_count,status,created_at,updated_at,snapshot_ids) VALUES(?,?,?,?,?,?,?)').run(id,owner,ids.length,'PREVIEW',t,t,JSON.stringify(ids));return view(owned(owner,id))}
 function get(owner,id){active(owner);return view(owned(owner,id))}
 function snapshot(op){try{const ids=JSON.parse(op.snapshot_ids);if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw new Error();return ids}catch{throw fail('STALE_PREVIEW')}}
 function sameIds(a,b){return a.length===b.length&&a.every((id,index)=>id===b[index])}
 function confirm(owner,id,expectedCount){active(owner);if(!Number.isInteger(expectedCount)||expectedCount<0)throw fail('CONFIRMATION_REQUIRED',400);const op=owned(owner,id);if(op.status!=='PREVIEW')return view(op);const previewIds=snapshot(op);if(expectedCount!==op.preview_count||previewIds.length!==op.preview_count||!sameIds(eligibleIds(owner),previewIds))throw fail('STALE_PREVIEW');db.exec('BEGIN IMMEDIATE');try{const current=owned(owner,id);if(current.status!=='PREVIEW'){db.exec('COMMIT');return view(current)}const ids=snapshot(current),liveIds=eligibleIds(owner);if(ids.length!==current.preview_count||!sameIds(liveIds,ids))throw fail('STALE_PREVIEW');let deleted={changes:0};if(ids.length){const placeholders=ids.map(()=>'?').join(',');deleted=db.prepare(`DELETE FROM prospects WHERE owner_id=? AND input_origin='EXCEL' AND status='DRAFT' AND id IN (${placeholders})`).run(owner,...ids)}if(deleted.changes!==ids.length)throw fail('STALE_PREVIEW');db.prepare("UPDATE prospect_excel_draft_delete_operations SET status='CONFIRMED',updated_at=? WHERE id=? AND status='PREVIEW'").run(now(),id);audit(owner,'PROSPECT_EXCEL_DRAFTS_DELETE_CONFIRM',id,'SUCCESS');db.exec('COMMIT');return view(owned(owner,id))}catch(error){db.exec('ROLLBACK');throw error}}
 return{preview,get,confirm};
}
module.exports={installProspectDeleteExcelDraftsService};
