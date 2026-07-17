// Kode Motor Honda - Full description (verified 2026-07-17)
// Format: "KODE-NAMA LENGKAP" (contoh: "LY2-BEAT ESP CBS ISS")
const MOTOR_MAP = {
  // BEAT Series
  "LY2":  "BEAT ESP CBS ISS",
  "NF0B": "BEAT STREET CBS ISS",
  "NE0B": "BEAT POP CBS ISS",
  "NF0C": "BEAT STREET DELUXE CBS",
  "NF0F": "BEAT DELUXE CBS",
  "NF0K": "BEAT POP DELUXE CBS",
  "NF0A": "BEAT STREET SPORTY CBS",
  "NF08": "BEAT POP ESP",

  // VARIO Series
  "MFG":  "VARIO 125 CBS ISS",
  "MFJ":  "VARIO 125 SP CBS ISS",
  "MFC":  "VARIO 125 TECHNO CBS",
  "MF2":  "VARIO 160 CBS ISS",
  "MF3":  "VARIO 160 SP CBS ISS",
  "MF1":  "VARIO 160 RC CBS",
  "MF0":  "VARIO 160 RC CBS ISS",

  // SCOOPY Series
  "SFC":  "SCOOPY ESP CBS ISS",
  "SFD":  "SCOOPY SP CBS ISS",
  "SFJ":  "SCOOPY LUXURAL CBS",
  "SFG":  "SCOOPY ESP PREMIUM",

  // GENIO Series
  "MHJ":  "GENIO CBS ISS",
  "MHK":  "GENIO SP CBS ISS",
  "MHL":  "GENIO LUXURAL CBS",

  // ADV Series
  "ML2":  "ADV 160 CBS ISS",
  "ML3":  "ADV 160 SP CBS ISS",
  "ML1":  "ADV 160 RC CBS",

  // PCX Series
  "MJD":  "PCX 160 CBS ISS",
  "MJF":  "PCX 160 SP CBS ISS",
  "MJL":  "PCX 160 LUXURAL CBS",

  // CLICK Series
  "MJV":  "CLICK 125 CBS",
  "MJW":  "CLICK 125 SP CBS",

  // REVO Series
  "KL2":  "REVO ABS",
  "KL3":  "REVO CBS",
  "KLC":  "REVO FIT",

  // SUPRA Series
  "JF01": "SUPRA GTR 150",
  "JF0":  "SUPRA X 125 FF",
  "JF1":  "SUPRA X 125 FI",
  "JF":   "SUPRA 125",

  // CB Series
  "MCT":  "CB 150 R",
  "MC1":  "CB 150 R SP",
  "K13":  "CB 150 VERZA",
  "K14":  "CB 150 VERZA SP",

  // CRF Series
  "K09":  "CRF 150 L",
  "K63":  "CRF 250 L",
  "K75":  "CRF 250 Rally",

  // MONKEY Series
  "MK2":  "MONKEY",
  "MK3":  "MONKEY SP",

  // FORZA Series
  "MGC":  "FORZA 250",
  "MGE":  "FORZA 350",

  // GOLDWING Series
  "RH":   "GOLDWING 1800",

  // DAX Series
  "MKL":  "DAX 125 CBS",
  "MKK":  "DAX 125 SP CBS",

  // ACCESORIES / LAINNYA
  "TBA":  "TBA",
};

// Format kode motor valid: 2-4 karakter (huruf kapital + angka)
const MOTOR_CODE_REGEX = /^[A-Z0-9]{2,6}$/i;

// Validasi kode motor
const validateMotorCode = (code) => {
  const normalized = code.toUpperCase().trim();
  
  // Cek apakah ada di list
  if (MOTOR_MAP[normalized]) {
    return { valid: true, code: normalized, name: MOTOR_MAP[normalized] };
  }
  
  // Jika format valid tapi tidak ada di list, accept sebagai free text
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
