'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseProspectBatch}=require('../src/prospect-batch-parser');

test('CSV/TXT diparse bounded, HP dinormalisasi, dan duplikat ditandai',()=>{
 const input='level,nama,hp,motor,nik,alamat,kecamatan,desa,rt,rw,source,pekerjaan\nLOW,Ani,0812-3456-7890,,,,,,,,1,Wiraswasta\nMEDIUM,Budi,628123456791,NE0B,,Jl Mawar,PENAJAM,PENAJAM,001,001,2,Karyawan Swasta\nLOW,Ani Dua,081234567890,,,,,,,,1,Wiraswasta';
 const out=parseProspectBatch(Buffer.from(input),{format:'csv'});assert.equal(out.rows.length,2);assert.equal(out.errors.length,1);assert.equal(out.rows[0].phone,'6281234567890');assert.equal(out.rows[1].level,'MEDIUM');assert.equal(out.errors[0].code,'DUPLICATE_PHONE_IN_FILE')
});

test('parser menolak oversized, terlalu banyak baris, kolom berbahaya, dan data level invalid',()=>{
 assert.throws(()=>parseProspectBatch(Buffer.alloc(1025),{format:'txt',maxBytes:1024}),e=>e.code==='BATCH_TOO_LARGE');
 assert.throws(()=>parseProspectBatch(Buffer.from('nama,hp\nA,081234567890\nB,081234567891'),{format:'csv',maxRows:1}),e=>e.code==='BATCH_ROW_LIMIT');
 const out=parseProspectBatch(Buffer.from('level,nama,hp,motor,nik,alamat,kecamatan,desa,rt,rw,source,pekerjaan\nHOT,=CMD(),081234567890,,123,Jl,PENAJAM,PENAJAM,1,1,1,X'),{format:'csv'});assert.equal(out.rows.length,0);assert.deepEqual(out.errors,[{row:2,code:'INVALID_ROW',field:'nama',reason:'FORMULA_NOT_ALLOWED'}]);
 const missing=parseProspectBatch(Buffer.from('level,nama,hp,motor,nik,alamat,kecamatan,desa\nMEDIUM,Budi,081234567890,LY2,,Jalan,PENAJAM,'),{format:'csv'});assert.deepEqual(missing.errors,[{row:2,code:'INVALID_ROW',field:'desa',reason:'REQUIRED_FOR_MEDIUM_HOT'}])
});

test('format/encoding dan kutip CSV ditangani fail-closed',()=>{
 const out=parseProspectBatch(Buffer.from('level,nama,hp,motor,nik,alamat,kecamatan,desa,rt,rw,source,pekerjaan\nLOW,"Ani, Sari",081234567890,,,,,,,,1,Wiraswasta'),{format:'csv'});assert.equal(out.rows[0].name,'Ani, Sari');
 assert.throws(()=>parseProspectBatch(Buffer.from([0xff,0xfe]),{format:'csv'}),e=>e.code==='BATCH_ENCODING_INVALID');assert.throws(()=>parseProspectBatch(Buffer.from('x'),{format:'xlsx'}),e=>e.code==='BATCH_FORMAT_INVALID')
});
