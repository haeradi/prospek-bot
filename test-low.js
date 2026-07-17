const fs = require('fs');
const XLSX = require('xlsx');
const jwt = fs.readFileSync('jwt.txt','utf8').trim();

const ENDPOINT = 'https://api.star.astra.co.id/graphql/';

const callStar = async (query, variables) => {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
};

(async () => {
  // Read first LOW row
  const wb = XLSX.readFile('/home/ubuntu/.hermes/cache/documents/doc_6552f31d3f32_FORMAT PROSPEK LOW 1.xlsx', {type:'file'});
  const ws = wb.Sheets['Sheet1'];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const headers = [];
  for (let C = range.s.c; C <= range.e.c; C++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c: C });
    headers.push((ws[addr]?.v?.toString() || '').toLowerCase().replace(/\s+/g, ''));
  }
  const hpIdx = headers.indexOf('nomorhp');
  const kodeAsalIdx = headers.indexOf('kodeasalprospek');
  const namaIdx = headers.indexOf('nama');
  const genderIdx = headers.indexOf('gender');
  const jenisIdx = headers.indexOf('jenissales');

  // Row 1 (first data)
  const R = range.s.r + 1;
  const getCell = (r, c) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    let v = ws[addr]?.v;
    if (v !== undefined && v !== null) return String(v).trim();
    return '';
  };

  const nama = getCell(R, namaIdx);
  const hpRaw = getCell(R, hpIdx);
  const hp = hpRaw.startsWith('0') ? '62' + hpRaw.slice(1) : hpRaw;
  const kodeAsal = getCell(R, kodeAsalIdx);
  const gender = getCell(R, genderIdx).toUpperCase().includes('PER') ? 'PEREMPUAN' : 'LAKI_LAKI';
  const jenis = getCell(R, jenisIdx);

  console.log('=== DATA ===');
  console.log('Jenis:', jenis);
  console.log('Nama:', nama);
  console.log('HP:', hp);
  console.log('Kode Asal:', kodeAsal);
  console.log('Gender:', gender);

  // JWT info
  const base64 = jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
  const claims = JSON.parse(Buffer.from(base64,'base64').toString());
  console.log('\n=== JWT ===');
  console.log('Name:', claims.name);
  console.log('Email:', claims.email);
  console.log('channelId:', claims.channelId);

  // WILAYAH dari JWT
  const ch = claims.channel || {};
  const WILAYAH = {
    provinceId: ch.provinceId || '',
    provinceName: ch.provinceName || 'KALIMANTAN TIMUR',
    districtId: ch.districtId || '',
    districtName: ch.districtName || 'KABUPATEN PENAJAM PASER UTARA',
    subDistrictId: ch.subDistrictId || '',
    subDistrictName: ch.subDistrictName || 'PENAJAM',
    villageId: ch.villageId || '',
    villageName: ch.villageName || 'PENAJAM',
    postalCode: ch.postalCode || ''
  };
  console.log('\n=== WILAYAH ===');
  console.log(JSON.stringify(WILAYAH));

  // Asal Prospek mapping
  const ASAL = {
    '1': { id: 'e12d3c21-c473-4801-a98b-1a1aa5a961e8', name: 'GATHERING' },
    '2': { id: '6bee11b6-4a5f-4e59-81ca-2e8b488c8eec', name: 'BUKU TAMU' },
    '3': { id: '0608f51d-23de-4fc3-b22f-61abf7eae9ed', name: 'CANVASING' },
    '4': { id: '43e1eb3c-6092-4d4a-889f-8b77ad2f1df1', name: 'AHASS' },
    '5a': { id: '49f1fac9-0da9-4a6a-971e-93fe1523e17d', name: 'PAMERAN BESAR' },
    '5b': { id: '69a499fc-19f7-49e1-bdb4-6d39de442a77', name: 'PAMERAN MENENGAH' },
    '6': { id: '3e42b5dc-7e92-430c-8e6d-14b54c785aae', name: 'ROADSHOW' },
  };
  const asal = ASAL[kodeAsal];
  console.log('\n=== ASAL PROSPEK ===');
  console.log(asal ? `${asal.name} (${asal.id})` : 'TIDAK DIKETAHUI');

  // STEP 1: Check duplicate
  const QRY = `query { getCustomerProspectFromCustomers(first: 50) { nodes { id prospectNumber mobilePhoneNumber } } }`;
  const allData = await callStar(QRY);
  const allNodes = allData?.data?.getCustomerProspectFromCustomers?.nodes || [];
  console.log('\n=== DEDUP ===');
  console.log('Total prospects:', allNodes.length);
  const dup = allNodes.find(n => n.mobilePhoneNumber === hp);
  if (dup) {
    console.log('❌ DUPLICATE! HP', hp, 'sudah terdaftar:', dup.prospectNumber);
    process.exit(1);
  }
  console.log('✅ HP', hp, 'belum terdaftar — lanjut create');

  // STEP 2: Create
  const MUT = `mutation create($data: DataCustomerProspectInputFromCustomers!) {
    ensureCreateCustomerProspectFromCustomers(data: $data) {
      id prospectNumber prospectStatus mobilePhoneNumber name
    }
  }`;

  const body = {
    name: nama,
    mobilePhoneNumber: hp,
    customerType: 'REGULAR',
    gender: gender,
    testRidePreference: false,
    tagPriority: true,
    prospectStatus: 'PROSPECT',
    channelId: claims.channelId,
    channelName: claims.channel?.channelName || claims.name,
    provinceId: WILAYAH.provinceId,
    provinceName: WILAYAH.provinceName,
    districtId: WILAYAH.districtId,
    districtName: WILAYAH.districtName,
    subDistrictId: WILAYAH.subDistrictId,
    subDistrictName: WILAYAH.subDistrictName,
    villageId: WILAYAH.villageId,
    villageName: WILAYAH.villageName,
    postalCode: WILAYAH.postalCode,
    rT: '001',
    rW: '001',
    address: 'PENAJAM',
    occupation: 'WIRASWASTA',
    religion: 'ISLAM',
    birthPlace: 'PENAJAM',
  };
  if (asal) body.sourceOfProspectHsoId = asal.id;

  console.log('\n=== CREATE BODY ===');
  console.log(JSON.stringify(body, null, 2));

  const result = await callStar(MUT, { data: body });
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));

  if (result.data?.ensureCreateCustomerProspectFromCustomers) {
    const p = result.data.ensureCreateCustomerProspectFromCustomers;
    console.log('\n✅ BERHASIL!');
    console.log('Nama:', p.name);
    console.log('HP:', p.mobilePhoneNumber);
    console.log('Prospect Number:', p.prospectNumber);
    console.log('Prospect ID:', p.id);
    console.log('Status:', p.prospectStatus);
  } else if (result.errors) {
    console.log('\n❌ ERROR:', JSON.stringify(result.errors));
  }
})();
