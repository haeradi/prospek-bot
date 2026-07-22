// Kode Motor Honda — VERIFIED LIVE vs Star API katalog resmi (2026-07-22)
// Sumber: getCustomerProspectFromCustomers → catalogueUnitDescription (read-back)
// Format: "KODE": "NAMA LENGKAP" (catalogueUnitDescription = "KODE-NAMA")
//
// ⚠️ PENTING: Kode di sini HARUS sesuai katalog resmi Star API.
// LY2 = GENIO (bukan BEAT) — API auto-expand LY2 → "LY2-GENIO CBS".
// Kode 2026 aktif: LH2A, LJ2, LK2A, LN3B, LR1, LV1, LY1A, LZ1, dll.
const MOTOR_MAP = {
  // ── BEAT Series (kode 2026) ──
  "LH2A": "BEAT SPORTY CBS PLUS",
  "LK2A": "BEAT SPORTY CBS ISS DELUXE PLUS",
  "LJ2":  "BEAT STREET",

  // ── GENIO Series (kode 2026) ──
  "LY1A": "GENIO CBS PLUS",
  "LZ1":  "GENIO CBS ISS",
  "LZ1A": "GENIO CBS ISS PLUS",
  "LY2":  "GENIO CBS",   // ⚠️ LY2 = GENIO (bukan BEAT) — verified live Star API

  // ── SCOOPY Series (kode 2026) ──
  "LN3B": "SCOOPY SPORTY STEP FLOOR PLUS",
  "LNJB": "SCOOPY FASHION STEP FLOOR PLUS",
  "LP3B": "SCOOPY PRESTIGE STEP FLOOR PLUS",
  "LPDB": "SCOOPY STYLISH STEP FLOOR PLUS",

  // ── VARIO Series (kode 2026) ──
  "LV1":  "Vario 160 CBS",

  // ── PCX Series (kode 2026) ──
  "LR1":  "PCX160 CBS",

  // ── REVO Series (kode 2026) ──
  "GB4":  "REVO FIT",
  "GD4":  "REVO X",

  // ── CRF Series ──
  "ESFB": "CRF150L PLUS",

  // ── CB / BIG BIKE Series ──
  "AW0":  "CB650R",
  "JC1":  "CB500X",
  "BB1":  "CMX 1100",

  // ── ACCESORIES / LAINNYA ──
  "TBA":  "TBA",
};

// Format kode motor valid: 2-6 karakter (huruf kapital + angka)
const MOTOR_CODE_REGEX = /^[A-Z0-9]{2,6}$/i;

// Validasi kode motor
const validateMotorCode = (code) => {
  const normalized = code.toUpperCase().trim();

  // Cek apakah ada di list
  if (MOTOR_MAP[normalized]) {
    return { valid: true, code: normalized, name: MOTOR_MAP[normalized] };
  }

  // Jika format valid tapi tidak ada di list, accept sebagai free text
  // (Star API akan auto-expand jika kode dikenali di master katalog)
  if (MOTOR_CODE_REGEX.test(normalized)) {
    return { valid: true, code: normalized, name: normalized }; // return code as name
  }

  return { valid: false };
};

// Get motor name dari code
const getMotorName = (code) => {
  const normalized = code.toUpperCase().trim();
  return MOTOR_MAP[normalized] || normalized;
};

// List semua motor untuk keyboard
const getMotorList = () => {
  return Object.keys(MOTOR_MAP).map(code => ({ code, name: MOTOR_MAP[code] }));
};

module.exports = { MOTOR_MAP, MOTOR_CODE_REGEX, validateMotorCode, getMotorName, getMotorList };
