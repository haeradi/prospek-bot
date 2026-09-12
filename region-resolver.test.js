const test=require('node:test');
const assert=require('node:assert/strict');
const {norm,resolveRegion}=require('./region-resolver');

test('normalizes common administrative prefixes',()=>{
 assert.equal(norm('Kabupaten Penajam Paser Utara'),'PENAJAM PASER UTARA');
 assert.equal(norm('Kec. Penajam'),'PENAJAM');
});

test('resolves full Penajam chain to verified ASSIST UUIDs',()=>{
 const r=resolveRegion({province:'Kalimantan Timur',district:'Kabupaten Penajam Paser Utara',subDistrict:'Penajam',village:'Sotek'});
 assert.equal(r.provinceId,'a1fa5044-9840-ed11-a9b8-8038fbe10c2f');
 assert.equal(r.districtId,'63c5524a-9840-ed11-a9b8-8038fbe10c2f');
 assert.equal(r.subDistrictId,'e9d6524a-9840-ed11-a9b8-8038fbe10c2f');
 assert.equal(r.villageId,'4d0bd454-9840-ed11-a9b8-8038fbe10c2f');
});

test('rejects unknown village instead of silently using Sepaku',()=>{
 assert.throws(()=>resolveRegion({province:'Kalimantan Timur',district:'Penajam Paser Utara',subDistrict:'Penajam',village:'TIDAK ADA'}),/tidak ditemukan/);
});
