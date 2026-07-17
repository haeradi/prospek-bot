// Occupation HSO UUID Mapping
const OCCUPATION_MAP = {
  "Wiraswasta":    { id: "1dc5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "1" },
  "Abri":          { id: "1ec5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "2" },
  "Pengacara":     { id: "1fc5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "3" },
  "Pegawai Negeri":{ id: "21c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "5" },
  "Pegawai Swasta":{ id: "20c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "4" },
  "Tidak Tetap":  { id: "22c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "6" },
  "Ibu Rumah Tangga": { id: "23c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "7" },
  "Petani":       { id: "24c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "8" },
  "Nelayan":      { id: "25c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "9" },
  "Seniman":      { id: "26c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "10" },
  "Pensiunan":    { id: "27c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "11" },
  "Pelaut":       { id: "28c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "12" },
  "Guru":         { id: "29c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "13" },
  "Jasa":         { id: "2ac5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "14" },
  "Dokter":       { id: "2bc5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "15" },
  "Ojek":         { id: "2cc5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "16" },
  "Sopir":        { id: "2dc5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "17" },
  "Peternak":     { id: "2ec5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "18" },
  "Mahasiswa":    { id: "2fc5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "19" },
  "Buruh":        { id: "30c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "20" },
  "Pengrajin":    { id: "31c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "21" },
  "Lainnya":      { id: "32c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "22" },
  "Pedagang":     { id: "33c5f91e-9940-ed11-a9b8-8038fbe10c2f", code: "23" },
};

const getOccupationHso = (name) => {
  const key = Object.keys(OCCUPATION_MAP).find(k => name.toUpperCase().includes(k.toUpperCase()));
  return key ? OCCUPATION_MAP[key] : null;
};

module.exports = { OCCUPATION_MAP, getOccupationHso };
