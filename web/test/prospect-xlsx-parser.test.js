'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseProspectXlsxRows,unwrapRows}=require('../src/prospect-xlsx-parser');
test('row XLSX diproyeksikan ke validator batch yang sama',()=>{const out=parseProspectXlsxRows([['level','nama','hp','motor','nik','alamat','kecamatan','desa','rt','rw','source','pekerjaan'],['LOW','Ani','081234567890','','','','','','','','1','Wiraswasta']]);assert.equal(out.rows[0].phone,'6281234567890')});
test('XLSX menolak row cap, formula, sheet kosong dan cell object',()=>{assert.throws(()=>parseProspectXlsxRows([['level','nama','hp'],['LOW','=CMD()','081234567890']]),e=>e.code==='BATCH_XLSX_UNSAFE');assert.throws(()=>parseProspectXlsxRows([]),e=>e.code==='BATCH_HEADERS_INVALID');assert.throws(()=>parseProspectXlsxRows([['level','nama','hp'],['LOW',{},'081234567890']]),e=>e.code==='BATCH_XLSX_UNSAFE');assert.throws(()=>parseProspectXlsxRows([['level','nama','hp'],['LOW','A','081234567890'],['LOW','B','081234567891']],{maxRows:1}),e=>e.code==='BATCH_ROW_LIMIT')});
test('XLSX menerima placeholder minus tetapi error unsafe menyebut lokasi sel',()=>{const out=parseProspectXlsxRows([['level','nama','hp','alamat'],['LOW','Ani','081234567890','-']]);assert.equal(out.rows.length,1);assert.throws(()=>parseProspectXlsxRows([['level','nama','hp'],['LOW','Ani','@SUM(A1)']]),e=>e.code==='BATCH_XLSX_UNSAFE'&&e.row===2&&e.column===3)});
test('XLSX format bot dipetakan per baris HOT MEDIUM LOW dan nilai tanggal normal tidak dianggap executable',()=>{const out=parseProspectXlsxRows([['Jenis Sales','kode asal prospek','Nama','Nomor HP','Alamat','Kecamatan','Kelurahan','tipe motor','Nomor NIK','Catatan'],['individu',3,'Hot','081234567891','Jl Hot','Penajam','Petung','VARIO','1234567890123456',new Date('2026-08-30T00:00:00Z')],['individu',3,'Medium','081234567892','Jl Uji','Penajam','Petung','VARIO','',''],['individu',3,'Low','081234567893','','','','','','']]);assert.equal(out.rows.length,3);assert.deepEqual(out.rows.map(x=>x.level),['HOT','MEDIUM','LOW']);assert.equal(out.rows[0].sourceCode,'3');assert.equal(out.rows[0].phone,'6281234567891')});
test('nomor HP numerik Excel yang kehilangan nol depan tetap dinormalisasi',()=>{
 const rows=[['Jenis Sales','Nama','Nomor HP'],['individu','BUDI',81286149760]];
 const out=parseProspectXlsxRows(rows);
 assert.equal(out.errors.length,0);
 assert.equal(out.rows[0].phone,'6281286149760');
});

test('XLSX wrapper ekspor bot dinormalisasi menjadi matriks data',()=>{const rows=[['Jenis Sales','Nama','Nomor HP'],['individu','Uji','081234567890']];assert.equal(unwrapRows([{sheet:'Sheet1',data:rows}]),rows)});
