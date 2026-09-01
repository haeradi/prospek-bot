'use strict';
const crypto=require('node:crypto');
const fail=(code,status=409)=>Object.assign(new Error(code),{code,status});
function installProspectDeleteExcelDraftsService({db,now=()=>new Date().toISOString(),audit=()=>{}}){
 db.exec(`CREATE TABLE IF NOT EXISTS prospect_excel_draft_delete_operations(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,preview_count INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
 const eligible=owner=>db.prepare("SELECT COUNT(*) count FROM prospects WHERE owner_id=? AND input_origin='EXCEL' AND status='DRAFT'").get(owner).count;
 function active(owner){const u=db.prepare('SELECT role,status FROM users WHERE id=?').get(owner);if(!u||u.role!=='SALES'||u.status!=='ACTIVE')throw fail('FORBIDDEN',403)}
 function owned(owner,id){const op=db.prepare('SELECT * FROM prospect_excel_draft_delete_operations WHERE id=? AND owner_id=?').get(id,owner);if(!op)throw fail('NOT_FOUND',404);return op}
 function view(op){return{id:op.id,count:op.preview_count,status:op.status,deleted:op.status==='CONFIRMED'?op.preview_count:0}}
 function preview(owner){active(owner);const id=crypto.randomUUID(),count=eligible(owner),t=now();db.prepare('INSERT INTO prospect_excel_draft_delete_operations VALUES(?,?,?,?,?,?)').run(id,owner,count,'PREVIEW',t,t);return view(owned(owner,id))}
 function get(owner,id){active(owner);return view(owned(owner,id))}
 function confirm(owner,id,expectedCount){active(owner);if(!Number.isInteger(expectedCount)||expectedCount<0)throw fail('CONFIRMATION_REQUIRED',400);const op=owned(owner,id);if(op.status!=='PREVIEW')return view(op);if(expectedCount!==op.preview_count||eligible(owner)!==op.preview_count)throw fail('STALE_PREVIEW');db.exec('BEGIN IMMEDIATE');try{const current=owned(owner,id);if(current.status!=='PREVIEW'){db.exec('COMMIT');return view(current)}if(eligible(owner)!==current.preview_count)throw fail('STALE_PREVIEW');const deleted=db.prepare("DELETE FROM prospects WHERE owner_id=? AND input_origin='EXCEL' AND status='DRAFT'").run(owner);if(deleted.changes!==current.preview_count)throw fail('STALE_PREVIEW');db.prepare("UPDATE prospect_excel_draft_delete_operations SET status='CONFIRMED',updated_at=? WHERE id=? AND status='PREVIEW'").run(now(),id);audit(owner,'PROSPECT_EXCEL_DRAFTS_DELETE_CONFIRM',id,'SUCCESS');db.exec('COMMIT');return view(owned(owner,id))}catch(error){db.exec('ROLLBACK');throw error}}
 return{preview,get,confirm};
}
module.exports={installProspectDeleteExcelDraftsService};
