const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'data', 'assist-regions.json');
let cache;

function norm(value) {
  return String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\b(KABUPATEN|KAB\.?|KOTA|KECAMATAN|KEC\.?|KELURAHAN|KEL\.?|DESA)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function load() {
  if (cache) return cache;
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')).data;
  const byId = Object.fromEntries(Object.entries(raw).map(([k, rows]) => [k, new Map(rows.map(x => [x.id, x]))]));
  const indexes = {};
  for (const [level, rows] of Object.entries(raw)) {
    const nameKey = `${level}Name`;
    indexes[level] = new Map();
    for (const row of rows) {
      const key = norm(row[nameKey]);
      if (!indexes[level].has(key)) indexes[level].set(key, []);
      indexes[level].get(key).push(row);
    }
  }
  return cache = { raw, byId, indexes };
}

function one(level, name, parentField, parentId) {
  const { indexes } = load();
  let rows = indexes[level].get(norm(name)) || [];
  if (parentField && parentId) rows = rows.filter(x => x[parentField] === parentId);
  if (!rows.length) throw new Error(`${level} tidak ditemukan: ${name}`);
  if (rows.length > 1) throw new Error(`${level} ambigu (${rows.length} hasil): ${name}; lengkapi wilayah parent`);
  return rows[0];
}

function resolveRegion({ province, district, subDistrict, village }) {
  const p = one('province', province);
  const d = one('district', district, 'provinceId', p.id);
  const s = one('subDistrict', subDistrict, 'districtId', d.id);
  const v = one('village', village, 'subDistrictId', s.id);
  return {
    provinceId: p.id, provinceName: p.provinceName,
    districtId: d.id, districtName: d.districtName,
    subDistrictId: s.id, subDistrictName: s.subDistrictName,
    villageId: v.id, villageName: v.villageName,
    postalCode: v.postalCode || ''
  };
}

module.exports = { norm, resolveRegion };
