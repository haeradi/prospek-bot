'use strict';
const {parseProspectBatch}=require('./prospect-batch-parser');
const fail=code=>{throw Object.assign(new Error(code),{code,status:400})};
function quote(x){const s=String(x??'');return `"${s.replaceAll('"','""')}"`}
function parseProspectXlsxRows(rows,{maxRows=500}={}){if(!Array.isArray(rows)||!rows.length)fail('BATCH_HEADERS_INVALID');if(rows.length-1>maxRows)fail('BATCH_ROW_LIMIT');for(const row of rows){if(!Array.isArray(row))fail('BATCH_XLSX_UNSAFE');for(const cell of row){if(cell!=null&&!['string','number','boolean'].includes(typeof cell))fail('BATCH_XLSX_UNSAFE');if(typeof cell==='string'&&/^[=+\-@]/.test(cell.trim()))fail('BATCH_XLSX_UNSAFE')}}const csv=rows.map(row=>row.map(quote).join(',')).join('\n');return parseProspectBatch(Buffer.from(csv),{format:'csv',maxRows})}
async function parseProspectXlsx(buffer,{maxBytes=1024*1024,maxRows=500}={}){if(!Buffer.isBuffer(buffer)||buffer.length>maxBytes)fail('BATCH_TOO_LARGE');let read;try{read=require('read-excel-file/node')}catch{fail('BATCH_XLSX_UNAVAILABLE')}let rows;try{rows=await read(buffer,{sheet:1})}catch{fail('BATCH_XLSX_INVALID')}return parseProspectXlsxRows(rows,{maxRows})}
module.exports={parseProspectXlsxRows,parseProspectXlsx};
