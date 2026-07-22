// prospek-bot/bot.js — Telegram bot untuk input prospek Star API
// Fitur: LOW (nama+hp), MEDIUM (+motor+alamat), HOT (+NIK), upgrade status
const { TelegramBot } = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const SA = require('./star-activity'); // activities + clock-in/out from Star API
const XLSX = require('xlsx');
const { getOccupationHso } = require('./occupation-map');
const { getMotorList, validateMotorCode } = require('./motor-map');
const VAULT = require('./vault-manager');

// ====== CONFIG ======
const TG_TOKEN = process.env.TG_TOKEN || fs.readFileSync(path.join(__dirname, 'tg_token.txt'), 'utf8').trim();
const JWT_FILE = path.join(__dirname, 'jwt.txt');
const STATE_FILE = path.join(__dirname, 'state.json');

let jwt = '';
try { jwt = fs.readFileSync(JWT_FILE, 'utf8').trim(); } catch {}

// Decode UUID from JWT sub claim (used ONLY for Bulk Not Deal filter)
// Does NOT affect createprospek / FF/Excel / other mutations
function decodeJwtUuid(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return payload.sub || null;
  } catch { return null; }
}
// Decode UUID from CURRENT active JWT sub claim (used for Bulk Not Deal filter)
// Re-reads jwt each call so it stays correct after account switch (/use, accounts:use)
function currentJwtUuid() {
  return decodeJwtUuid(jwt) || '';
}

// ====== AUDIT LOG ======
const LOG_DIR = path.join(__dirname, 'logs');
const AUDIT_FILE = path.join(LOG_DIR, 'audit.log');

function logAudit(action, details = {}) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      tz: 'Asia/Makassar',
      action,
      jwtOwner: (() => { try { const p = JSON.parse(Buffer.from(jwt.split('.')[1],'base64').toString('utf8')); return p.name || '?'; } catch { return '?'; } })(),
      chatId: null, // set per-call below
      ...details,
    };
    const line = JSON.stringify(entry) + '\n';
    if (!existsSync(LOG_DIR)) return;
    fs.appendFileSync(AUDIT_FILE, line);
  } catch {}
}

function auditLog(action, details = {}, chatId = null) {
  try {
    const p = { ts: new Date().toISOString(), tz: 'Asia/Makassar', action, chatId,
      jwtOwner: (() => { try { const pp = JSON.parse(Buffer.from(jwt.split('.')[1],'base64').toString('utf8')); return pp.name || '?'; } catch { return '?'; } })(),
      ...details };
    if (!existsSync(LOG_DIR)) return;
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(p) + '\n');
  } catch {}
}

// ====== STAR API ======
const STAR_API = 'https://api.star.astra.co.id/graphql/';
const ORIGIN   = 'https://assist.star.astra.co.id';

// callStar uses execSync+curl (more reliable than Node fetch for Star API)
const execSync = require('child_process').execSync;
const callStar = (query, vars) => {
  const body = JSON.stringify({ query, variables: vars || {} });
  const escaped = body.replace(/'/g, "'\\''");
  const cmd = `curl -s --max-time 30 '${STAR_API}' ` +
    `-H 'Authorization: Bearer ${jwt}' ` +
    `-H 'Content-Type: application/json; charset=utf-8' ` +
    `-H 'origin: ${ORIGIN}' ` +
    `-H 'referer: ${ORIGIN}/' ` +
    `-H 'user-agent: Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36' ` +
    `-d '${escaped}'`;
  // Audit: log all Star API mutations (create/update prospect, follow-up, status)
  try {
    if (query.includes('mutation')) {
      const name = query.match(/mutation\s+(\w+)/)?.[1] || '?';
      const keys = Object.keys(vars?.data || {}).slice(0, 4).join(',');
      auditLog('star_mutation', { mutation: name, fields: keys });
    }
  } catch {}

  let stdout;
  try {
    stdout = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    if (e.stdout) stdout = e.stdout; else throw e;
  }
  const json = JSON.parse(stdout);
  if (json.errors) throw new Error(json.errors.map(e => e.message).join(', '));
  return json.data;
};

// ====== WILAYAH UUID (KALIMANTAN TIMUR - PENAJAM) ======
// Dari hasil reverse-engineering Star API
const WILAYAH = {
  provinceId: 'a1fa5044-9840-ed11-a9b8-8038fbe10c2f',
  provinceName: 'KALIMANTAN TIMUR',
  districtId: '63c5524a-9840-ed11-a9b8-8038fbe10c2f',
  districtName: 'PENAJAM PASER UTARA',
  subDistrictId: 'ecd6524a-9840-ed11-a9b8-8038fbe10c2f',
  subDistrictName: 'SEPAKU',
  postalCode: '76148',
  // villageId lookup by name (default: SEPAKU)
  villageId: '6b0bd454-9840-ed11-a9b8-8038fbe10c2f',
  villageName: 'SEPAKU',
};

// ====== FOLLOW-UP MUTATION ======
const MUT_FOLLOWUP = `mutation CreateFollowUp($input: DataFollowUpHistoryInputFromCustomers!) {
  ensureCreateFollowUpProspectFromCustomers(input: $input) { id }
}`;

const decodeJwt = (tok) => {
  try {
    const p = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
    return p;
  } catch { return null; }
};

const jwtInfo = () => {
  if (!jwt) return '🔴 **Belum di-set**\nGunakan /jwt <token>';
  const p = decodeJwt(jwt);
  if (!p) return '🔴 **Token tidak valid**';
  const exp = new Date(p.exp * 1000);
  const now = new Date();
  const ok = exp > now;
  const sisa = Math.round((exp - now) / 3600000 * 10) / 10;
  return (ok ? '🟢' : '🔴') + ` *${p.name || '?'}* (${p.email || '?'})\n`
    + `⏳ Exp: ${exp.toLocaleString('id-ID', { timeZone: 'Asia/Makassar', hour12: false })}\n`
    + `Sisa: ${sisa} jam`;
};

const jwtChannelId = () => {
  const p = decodeJwt(jwt);
  if (p?.roles) {
    try {
      const roles = JSON.parse(p.roles);
      const ba = roles.find(r => r.ConnectionType === 'BusinessArea');
      if (ba?.ConnectionId) return ba.ConnectionId;
    } catch {}
  }
  return '11a79f5c-9840-ed11-a9b8-8038fbe10c2f';
};
const jwtChannelName = () => 'ASTRA MOTOR PENAJAM';
const jwtName = () => decodeJwt(jwt)?.name || '-';

// ====== MUTATIONS ======
const MUT_CREATE = `mutation SubmitCustomerProspect($data: DataCustomerProspectInputFromCustomers!) {
  ensureCreateCustomerProspectFromCustomers(input: $data) { id prospectNumber created prospectStatus }
}`;
const MUT_UPDATE_STATUS = `mutation UpdateCustomerProspect($data: UpdateCustomerProspectStatusInputFromCustomers!) {
  ensureUpdateCustomerProspectStatusFromCustomers(input: $data) { id prospectStatus }
}`;
const QRY_LIST = `query GetProspek {
  getCustomerProspectFromCustomers(first: 100) {
    nodes { id prospectNumber name mobilePhoneNumber prospectStatus created }
  }
}`;
const QRY_SEARCH = `query GetProspek {
  getCustomerProspectFromCustomers(first: 50) {
    nodes { id prospectNumber name mobilePhoneNumber prospectStatus created iDNumber address description catalogueUnitColorDescription }
  }
}`;

// ====== ASAL PROSPEK MAPPING ======
const ASAL_PROSPEK = {
  "1":  { id: "4ad4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Gathering / Showroom Event" },
  "2":  { id: "4bd4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Buku Tamu" },
  "3":  { id: "4cd4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Canvassing" },
  "4":  { id: "4dd4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Ruang Tunggu AHASS" },
  "5a": { id: "4ed4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Pameran Besar" },
  "5b": { id: "4fd4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Pameran Menengah / Kecil" },
  "6":  { id: "50d4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Roadshow" },
  "9a": { id: "51d4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Facebook Comment/Message" },
  "9c": { id: "53d4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Facebook Live" },
  "9d": { id: "54d4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Instagram Comment/DM" },
  "9f": { id: "56d4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Instagram Live" },
  "9g": { id: "57d4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Twitter Comment/Message" },
  "10": { id: "59d4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Flyering" },
  "55": { id: "82d4a103-4aa6-4d48-88e1-7bba6cb95d77", name: "Tiktok" },
};

// ====== ASAL PROSPEK KEYBOARD ======
const asalKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: '1. Gathering/Showroom', callback_data: 'asal:1' }],
      [{ text: '2. Buku Tamu', callback_data: 'asal:2' }],
      [{ text: '3. Canvassing', callback_data: 'asal:3' }],
      [{ text: '4. Ruang Tunggu AHASS', callback_data: 'asal:4' }],
      [{ text: '5a. Pameran Besar', callback_data: 'asal:5a' }],
      [{ text: '5b. Pameran Menengah/Kecil', callback_data: 'asal:5b' }],
      [{ text: '6. Roadshow', callback_data: 'asal:6' }],
      [{ text: '9a. FB Comment/Message', callback_data: 'asal:9a' }],
      [{ text: '9c. Facebook Live', callback_data: 'asal:9c' }],
      [{ text: '9d. IG Comment/DM', callback_data: 'asal:9d' }],
      [{ text: '9f. Instagram Live', callback_data: 'asal:9f' }],
      [{ text: '9g. Twitter Comment/Msg', callback_data: 'asal:9g' }],
      [{ text: '10. Flyering', callback_data: 'asal:10' }],
      [{ text: '55. Tiktok', callback_data: 'asal:55' }],
      [{ text: '⬅️ Batal', callback_data: 'cancel' }],
    ]
  }
});

// ====== MOTOR KEYBOARD ======
const motorKeyboard = () => {
  const motors = getMotorList();
  const keyboard = [];
  // Tampilkan 4 motor terpopuler
  const popular = ["LY2", "NF0B", "NE0B", "MF2", "MFG", "SFC"];
  for (let i = 0; i < popular.length; i += 2) {
    const row = [];
    if (popular[i]) row.push({ text: `${popular[i]}`, callback_data: `motor:${popular[i]}` });
    if (popular[i + 1]) row.push({ text: `${popular[i + 1]}`, callback_data: `motor:${popular[i + 1]}` });
    if (row.length > 0) keyboard.push(row);
  }
  keyboard.push([{ text: '📋 Lihat Semua Motor', callback_data: 'motor:list' }]);
  keyboard.push([{ text: '⬅️ Batal', callback_data: 'cancel' }]);
  return { reply_markup: { inline_keyboard: keyboard } };
};
// ====== STATUS HIERARCHY ======
const STATUS_LEVEL = { LOST: -1, LOW: 0, MEDIUM: 1, HOT: 2, DEAL: 3, PROSPECT: 0 };
const VALID_UPGRADES = {
  LOW:  ['MEDIUM', 'HOT', 'DEAL', 'LOST'],
  MEDIUM: ['HOT', 'DEAL', 'LOST'],
  HOT: ['DEAL', 'LOST'],
  PROSPECT: ['MEDIUM', 'HOT', 'DEAL', 'LOST'],
};

// ====== BOT ======
const bot = new TelegramBot(TG_TOKEN, {
  polling: {
    params: {
      allowed_updates: ['message', 'callback_query', 'inline_query', 'chosen_inline_result', 'channel_post']
    }
  }
});

// In-memory conversation state (persisted to state.json on every set)
// Safe: only affects bot conversation flow, does NOT touch Star API calls
let conv = new Map();
try { const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); conv = new Map(Object.entries(saved)); } catch {}

// Wrapped conv.set — auto-saves to disk on every change
const convSet = (chatId, state) => {
  conv.set(chatId, state);
  try {
    const obj = Object.fromEntries(conv);
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2));
  } catch {}
};
const convGet = (chatId) => conv.get(chatId);

// ====== KEYBOARDS ======
const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📝 Prospek LOW', callback_data: 'create:LOW' },
       { text: '📝 Prospek MEDIUM', callback_data: 'create:MEDIUM' },
       { text: '📝 Prospek HOT', callback_data: 'create:HOT' }],
      [{ text: '⬆️ Upgrade Status', callback_data: 'upgrade:menu' },
       { text: '📋 Cari Prospek', callback_data: 'search:menu' }],
      [{ text: '📊 FF / Excel', callback_data: 'ff:menu' },
       { text: '🔑 Set JWT', callback_data: 'setjwt' }],
      [{ text: '🚫 Bulk Not Deal', callback_data: 'notdeal:menu' },
       { text: '🔐 Akun', callback_data: 'accounts:menu' }],
    ]
  }
};

const cancelBtn = () => ({ reply_markup: { inline_keyboard: [[{ text: '⬅️ Batal', callback_data: 'cancel' }]] } });
const backBtn = (cb) => ({ reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: cb }]] } });
const confirmBtn = () => ({ reply_markup: { inline_keyboard: [[{ text: '✅ Kirim', callback_data: 'confirm' }, { text: '⬅️ Batal', callback_data: 'cancel' }]] } });

// ====== NOT DEAL REASONS ======
const REASONS_NOT_DEAL = [
  'TIDAK_BERMINAT', 'HARGA_MAHAL', 'SUDAH_PUNYA', 'DOWN_PAYMENT_MAHAL',
  'JARAK_TEMPAT', 'RESPON_LAMBAT', 'TIDAK_RESPON', 'BANTUAN_PIMPINAN',
  'LAINNYA', 'SISA_STOK', 'MOTOR_SEDANG_SERVIS', 'TIDAK_LAYAK_KREDIT',
  'OVER_KREDIT', 'BANDING_HARGA'
];
const reasonKeyboard = () => {
  const rows = [];
  for (let i = 0; i < REASONS_NOT_DEAL.length; i += 2) {
    rows.push(REASONS_NOT_DEAL.slice(i, i + 2).map(r => ({ text: r, callback_data: `notdeal:reason:${r}` })));
  }
  rows.push([{ text: '⬅️ Batal', callback_data: 'cancel' }]);
  return { reply_markup: { inline_keyboard: rows } };
};

const notdealStatusKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: '🔥 HOT', callback_data: 'notdeal:status:HOT' },
       { text: '🟡 MEDIUM', callback_data: 'notdeal:status:MEDIUM' }],
      [{ text: '🟢 LOW', callback_data: 'notdeal:status:LOW' }],
      [{ text: '🔴 SEMUA (HOT+MEDIUM+LOW)', callback_data: 'notdeal:status:ALL' }],
      [{ text: '⬅️ Batal', callback_data: 'cancel' }],
    ]
  }
});

const promptMsg = (chatId, text, opts) => bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
const editMsg = async (chatId, msgId, text, opts) => {
  try { await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...opts }); }
  catch { await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts }); }
};

// ====== FF/EXCEL PARSER ======
// Format: individu X NAMA LAKI-LAKI/LAKI-LAKI ALAMAT RT. 00X KALIMANTAN TIMUR KABUPATEN ... PENAJAM DESA RT RW GENDER AGAMA PEKERJAAN HP STATUS BAYAR KODEMOTOR
// Contoh:
// Format supported:
//   Spasi:  individu 3 NAMA LAKI-LAKI ALAMAT ... KODEMOTOR
//   Pipe:   individu|3|NAMA|LAKI-LAKI|ALAMAT|...|KODEMOTOR

const parseIndividuLine = (line) => {
  // Normalize: collapse multiple spaces, trim
  const normalized = line.replace(/\s+/g, ' ').trim();
  
  // Check prefix
  if (!normalized.toLowerCase().startsWith('individu')) {
    return { error: 'Format harus dimulai dengan "individu"' };
  }
  
  // Detect separator: pipe | vs space
  const afterPrefix = normalized.slice(8).trim();
  const usePipe = afterPrefix.includes('|');
  
  let parts;
  if (usePipe) {
    parts = afterPrefix.split('|').map(p => p.trim());
  } else {
    parts = afterPrefix.split(' ');
  }
  
  if (parts.length < 10) {
    return { error: 'Data terlalu pendek. Gunakan format: individu|NO|NAMA|GENDER|ALAMAT|PROVINSI|KABUPATEN|KECAMATAN|DESA|RT|RW|GENDER|AGAMA|PEKERJAAN|HP|STATUS|BAYAR|KODEMOTOR' };
  }
  
  // Pipe format field mapping:
  // 0=no, 1=nama, 2=alamat, 3=provinsi, 4=kabupaten, 5=kecamatan, 6=desa, 7=rt, 8=rw,
  // 9=gender, 10=agama, 11=pekerjaan, 12=hp, 13=status, 14=bayar, 15=kodeMotor, 16=nik
  
  let noUrut, nama, gender, alamat, rt, rw, provinsi, kabupaten, kecamatan, desa, agama, pekerjaan, hp, statusKredit, kodeMotor, nik;
  
  if (usePipe) {
    // Skip empty first element if parts[0] is empty (case: "individu|3|...")
    const offset = parts[0] === '' ? 1 : 0;
    noUrut    = parts[offset + 0] || '1';
    nama      = (parts[offset + 1] || '').toUpperCase();
    alamat    = (parts[offset + 2] || '').toUpperCase();
    provinsi  = (parts[offset + 3] || 'KALIMANTAN TIMUR').toUpperCase();
    kabupaten = (parts[offset + 4] || '').toUpperCase();
    kecamatan = (parts[offset + 5] || '').toUpperCase();
    desa      = (parts[offset + 6] || '').toUpperCase();
    rt        = (parts[offset + 7] || '001').replace(/^0+/, '') || '1';
    rw        = (parts[offset + 8] || '000').replace(/^0+/, '') || '0';
    gender    = (parts[offset + 9] || 'LAKI-LAKI').toUpperCase().includes('PER') ? 'PEREMPUAN' : 'LAKI_LAKI';
    agama     = (parts[offset + 10] || 'ISLAM').toUpperCase();
    pekerjaan = (parts[offset + 11] || '').toUpperCase();
    hp        = normalizeHP(parts[offset + 12] || '');
    statusKredit = parts[offset + 13] || 'tidak';
    kodeMotor = (parts[offset + 15] || parts[offset + 14] || '').toUpperCase().trim();
    nik       = (parts[offset + 16] || '').replace(/[^0-9]/g, '');
  } else {
    // Space format parser (existing logic)
    let idx = 0;
    noUrut = parts[idx++];
    const genderKeywords = ['LAKI-LAKI', 'LAKI', 'PEREMPUAN'];
    let namaEndIdx = idx;
    while (namaEndIdx < parts.length && parts[namaEndIdx] && !genderKeywords.includes(parts[namaEndIdx].toUpperCase())) namaEndIdx++;
    nama = parts.slice(idx, namaEndIdx).join(' ').toUpperCase();
    idx = namaEndIdx;
    const genderInput = (parts[idx++] || 'LAKI-LAKI').toUpperCase();
    gender = genderInput.includes('PER') ? 'PEREMPUAN' : 'LAKI_LAKI';
    let alamatEndIdx = idx;
    while (alamatEndIdx < parts.length && parts[alamatEndIdx] && !parts[alamatEndIdx].toUpperCase().startsWith('KALIMANTAN')) alamatEndIdx++;
    alamat = parts.slice(idx, alamatEndIdx).join(' ').replace(/RT\.?\s*00?/gi, 'RT ').trim().toUpperCase();
    idx = alamatEndIdx;
    if (idx >= parts.length || !parts[idx].toUpperCase().startsWith('KALIMANTAN')) {
      return { error: 'Provinsi tidak ditemukan' };
    }
    provinsi = parts[idx++].toUpperCase();
    let locationEndIdx = idx;
    while (locationEndIdx < parts.length && parts[locationEndIdx] && !['PENAJAM', 'SEPAKU', 'BABULANG', 'BABO', 'WARU'].includes(parts[locationEndIdx].toUpperCase())) locationEndIdx++;
    while (idx < locationEndIdx && parts[idx] && parts[idx].toUpperCase().match(/^(KABUPATEN|KOTA|KECAMATAN|DESA|KELURAHAN)$/)) idx++;
    desa = parts[idx] || 'PENAJAM';
    idx = locationEndIdx;
    rt = parts[idx++] || '001';
    rw = parts[idx++] || '000';
    while (idx < parts.length && parts[idx] && !genderKeywords.includes(parts[idx].toUpperCase())) idx++;
    if (idx < parts.length) idx++;
    agama = parts[idx++] || 'ISLAM';
    let pekerjaanEndIdx = idx;
    while (pekerjaanEndIdx < parts.length && parts[pekerjaanEndIdx] && !parts[pekerjaanEndIdx].match(/^(08|62)/)) pekerjaanEndIdx++;
    pekerjaan = parts.slice(idx, pekerjaanEndIdx).join(' ').replace(/\//g, ' ').trim().toUpperCase();
    idx = pekerjaanEndIdx;
    hp = parts[idx++] || '';
    while (hp.length < 10 && idx < parts.length) {
      const next = parts[idx];
      if (next && (next.match(/^(08|62)/) || next.match(/^\d{10,}$/))) { hp += next; idx++; } else break;
    }
    hp = normalizeHP(hp);
    let statusWord = parts[idx]?.toLowerCase() || '';
    statusKredit = statusWord.includes('kredit') || statusWord.includes('tunai') ? statusWord : parts[idx + 1]?.toLowerCase() || '';
    if (statusKredit.includes('kredit')) idx += 2; else idx++;
    kodeMotor = '';
    while (idx < parts.length && parts[idx]) {
      const p = parts[idx].toUpperCase();
      if (p.match(/^[A-Z]{2,3}\d?[A-Z]?$/)) { kodeMotor = p; break; }
      idx++;
    }
  }
  
  const occupation = getOccupationHso(pekerjaan);
  // Only set motor if kodeMotor is a valid motor code (not TUNAI, kosong, etc.)
  const motorCodes = new Set(getMotorList().map(m => m.code));
  const motor = kodeMotor && motorCodes.has(kodeMotor)
    ? { code: kodeMotor, name: getMotorList().find(m => m.code === kodeMotor)?.name || kodeMotor }
    : null;
  
  return {
    success: true,
    data: {
      no: noUrut,
      nama,
      gender,
      alamat: alamat || 'PENAJAM',
      rt: rt.replace(/^0+/, '') || '1',
      rw: rw.replace(/^0+/, '') || '0',
      agama,
      pekerjaan,
      occupationHso: occupation,
      hp,
      statusKredit: statusKredit.includes('kredit') ? 'kredit' : 'tunai',
      motor,
      nik: nik || null,
      // Extra fields for pipe format
      ...(usePipe ? { provinsi, kabupaten, kecamatan, desa } : {}),
    },
  };
};

// Helper: normalize HP number to 62xxxxxxxxxx
const normalizeHP = (hp) => {
  let h = String(hp).replace(/[^0-9]/g, '');
  if (h.startsWith('0')) h = '62' + h.slice(1);
  return h;
};

// ====== CREATE PROSPEK ======
const createProspek = async (data) => {
  const isLOW = data.level === 'LOW';
  const body = {
    name: data.name,
    mobilePhoneNumber: data.phone,
    customerType: 'REGULAR',
    gender: data.gender || 'LAKI_LAKI',
    testRidePreference: false,
    tagPriority: true,
    preferenceSalesType: 'CREDIT',
    prospectStatus: 'PROSPECT', // Always create as PROSPECT, upgrade via follow-up for all levels
    channelId: jwtChannelId(),
    channelName: jwtChannelName(),
    // Occupation (teks biasa, tidak perlu UUID)
    occupation: data.occupation || 'Wiraswasta',
    religion: 'ISLAM',
    birthPlace: 'PENAJAM',
  };
  
  // WILAYAH fields only for MEDIUM/HOT — LOW tidak perlu alamat/provinsi/dsb
  if (!isLOW) {
    body.provinceId = WILAYAH.provinceId;
    body.provinceName = WILAYAH.provinceName;
    body.districtId = WILAYAH.districtId;
    body.districtName = WILAYAH.districtName;
    body.subDistrictId = WILAYAH.subDistrictId;
    body.subDistrictName = WILAYAH.subDistrictName;
    body.villageId = WILAYAH.villageId;
    body.villageName = WILAYAH.villageName;
    body.postalCode = WILAYAH.postalCode;
    body.rT = data.rt || '001';
    body.rW = data.rw || '001';
    body.address = data.address || 'PENAJAM';
  }
  
  // Optional fields
  if (data.motorType) {
    body.catalogueUnitDescription = data.motorType;
    body.catalogueUnitColorDescription = data.motorType;
  }
  if (data.nik) body.iDNumber = data.nik;
  if (data.description) body.description = data.description;
  
  // Asal Prospek (WAJIB)
  if (data.asalId) {
    body.sourceOfProspectHsoId = data.asalId;
  }
  
  // Occupation dengan UUID
  if (data.occupation) {
    const occ = getOccupationHso(data.occupation);
    if (occ) {
      body.occupationFirstHsoId = occ.id;
      body.occupationFirstHsoName = data.occupation;
      body.occupationFirstHsoCode = occ.code;
    }
    body.occupation = data.occupation;
  }
  
  const result = callStar(MUT_CREATE, { data: body });
  const prospect = result.ensureCreateCustomerProspectFromCustomers;
  
  // Auto update status untuk MEDIUM/HOT via ensureUpdateCustomerProspectStatusFromCustomers
  if (!isLOW) {
    const statusLevel = data.level; // 'MEDIUM' or 'HOT'
    try {
      callStar(MUT_UPDATE_STATUS, {
        data: {
          customerProspectId: prospect.id,
          prospectStatus: statusLevel,
          reason: 'Update via @Rd_prospek_bot'
        }
      });
      prospect.prospectStatus = statusLevel; // reflect updated status
    } catch (e) {
      console.error('Status update error:', e.message);
    }
  }
  
  return prospect;
};

const updateStatus = (prospectId, status) => {
  return callStar(MUT_UPDATE_STATUS, {
    data: { customerProspectId: prospectId, prospectStatus: status, reason: 'Update via @Rd_prospek_bot' }
  });
};

// ====== /start ======
bot.onText(/^\/start/, async (msg) => {
  conv.delete(msg.chat.id);
  auditLog('start', { chatId: msg.chat.id, username: msg.from.username });
  await bot.sendMessage(msg.chat.id,
    `👋 *Prospek Bot — Astra Motor Penajam*\n\n`
    + `📌 *Level Prospek:*\n`
    + `▪️ LOW: Nama + No HP\n`
    + `▪️ MEDIUM: Nama + HP + Tipe Motor + Alamat\n`
    + `▪️ HOT: Nama + HP + Tipe Motor + NIK + Alamat\n\n`
    + `⬆️ Status bisa naik (LOW→MEDIUM→HOT→DEAL), tidak bisa turun.\n`
    + `🔴 Akhir bulan: prospek non-DEAL jadi LOST.\n\n`
    + `JWT: *${jwtName()}*`,
    { parse_mode: 'Markdown', ...mainMenu }
  );
});

// /jwt
bot.onText(/^\/jwt\s+(.+)/, async (msg, match) => {
  const token = match[1].trim();
  const claims = decodeJwt(token);
  if (!claims) return bot.sendMessage(msg.chat.id, '❌ Token tidak valid.');
  jwt = token;
  fs.writeFileSync(JWT_FILE, jwt);
  auditLog('setjwt', { chatId: msg.chat.id, name: claims.name });
  await bot.sendMessage(msg.chat.id,
    `✅ JWT tersimpan!\n👤 ${claims.name} (${claims.email})\n⏳ Exp: ${new Date(claims.exp*1000).toLocaleString('id-ID', {timeZone:'Asia/Makassar',hour12:false})} WITA`,
    mainMenu);
});

// ── Account group helpers ───────────────────────────────────────────────────────────
const TEAM_GROUPS = {
  'OWNER / UTAMA': ['H704'],
  'BABULU':        ['SEPTHI', 'NURLELA'],
  'SOTEK':         ['NORMAYANTI', 'RESKI'],
  'GIRIMUKTI':     ['DESI', 'TIARA'],
  'SEPAKU':        ['RANGA'],
};

// status emoji + label
function _s(st) {
  if (st.status === 'valid')           return { emoji: '🟢', label: `Aktif ${st.remainingStr}` };
  if (st.status === 'expiring_soon')   return { emoji: '🟡', label: `Expiring ${st.remainingStr}` };
  if (st.status === 'expired')         return { emoji: '🔴', label: 'Expired' };
  if (st.status === 'no_jwt')         return { emoji: '⚪', label: 'Belum Login' };
  return                                     { emoji: '❓', label: 'Unknown' };
}

function formatAccountsList(accounts) {
  const activeCode = fs.existsSync(JWT_FILE)
    ? (() => {
        try {
          const payload = JSON.parse(Buffer.from(fs.readFileSync(JWT_FILE,'utf8').trim().split('.')[1],'base64').toString('utf8'));
          return payload.user_code || payload.name || '';
        } catch { return ''; }
      })()
    : '';

  const lines = [
    '━━━━━━━━━━━━━━━━━━━━',
    '  🔐  MANAJEMEN AKUN STAR API',
    '━━━━━━━━━━━━━━━━━━━━',
    `  📌 Active : ${activeCode || '—'}`,
    ''
  ];

  for (const [grp, codes] of Object.entries(TEAM_GROUPS)) {
    const members = accounts.filter(a => codes.includes(a.code));
    if (!members.length) continue;
    lines.push(`  ${'─'.repeat(26)}`);
    lines.push(`  📂 ${grp}`);
    for (const a of members) {
      const st = VAULT.getJwtStatus(a.code);
      const { emoji, label } = _s(st);
      lines.push(`    ${emoji}  ${a.code.padEnd(12)} ${label}`);
    }
    lines.push('');
  }

  lines.push('  ┌──────────────────────────┐');
  lines.push('  │  👆 Klik akun untuk detail  │');
  lines.push('  └──────────────────────────┘');
  return lines.join('\n');
}

function buildAccountsMenuKeyboard(accounts) {
  const rows = [];
  for (const [grp, codes] of Object.entries(TEAM_GROUPS)) {
    const members = accounts.filter(a => codes.includes(a.code));
    if (!members.length) continue;
    rows.push([{ text: `▸ ${grp}`, callback_data: 'noop' }]);
    for (const a of members) {
      const st = VAULT.getJwtStatus(a.code);
      const { emoji, label } = _s(st);
      rows.push([{ text: `${emoji}  ${a.code}  ·  ${label}`, callback_data: `accounts:detail:${a.code}` }]);
    }
  }
  rows.push([{ text: '───────────────────', callback_data: 'noop' }]);
  rows.push([{ text: '➕ Tambah Akun', callback_data: 'accounts:add:start' }]);
  rows.push([{ text: '🔙 Menu Utama',   callback_data: 'menu' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function buildAccountDetailKeyboard(code) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Relogin',   callback_data: `accounts:relogin:${code}` },
         { text: '⚡ Pakai JWT', callback_data: `accounts:use:${code}` }],
        [{ text: '✏️ Edit',  callback_data: `accounts:edit:${code}` },
         { text: '🗑️ Hapus', callback_data: `accounts:delete:${code}` }],
        [{ text: '⬅️ Kembali', callback_data: 'accounts:menu' }],
      ]
    }
  };
}

function buildAccountEditKeyboard(code) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✏️ Email',       callback_data: `accounts:edit_email:${code}` }],
        [{ text: '🔑 Password',    callback_data: `accounts:edit_password:${code}` }],
        [{ text: '🏪 Nama Dealer', callback_data: `accounts:edit_dealer:${code}` }],
        [{ text: '⬅️ Kembali',    callback_data: `accounts:detail:${code}` }],
      ]
    }
  };
}

// /accounts — list all vault accounts
bot.onText(/^\/accounts/, async (msg) => {
  const accounts = VAULT.listAccounts();
  await bot.sendMessage(msg.chat.id, formatAccountsList(accounts), {
    ...buildAccountsMenuKeyboard(accounts)
  });
});

// ── /aktivitas — Clock-in/out activities from Star API ─────────────────────
bot.onText(/^\/aktivitas(?:\s+(\S+))?$/, async (msg, match) => {
  const sub = (match[1] || '').toUpperCase();
  auditLog('aktivitas', { chatId: msg.chat.id, sub: sub || 'ALL' });
  await bot.sendMessage(msg.chat.id, '⏳ Mengambil data aktivitas dari Star API...', { parse_mode: 'HTML' });

  try {
    const report = await SA.getFullActivityReport();

    let text;
    if (sub === 'POS') {
      text = SA.formatPOSReport(report);
    } else if (sub === 'BTL') {
      text = SA.formatBTLReport(report);
    } else {
      // Default: combined BTL + POS, grouped by status (clean WA-friendly)
      text = SA.formatActivityReportV2(report);
    }

    await bot.sendMessage(msg.chat.id, text, mainMenu);
  } catch (e) {
    const jwt = SA.verifyJwt();
    let hint = '';
    if (jwt.ok) {
      hint = `\n\nJWT: ✅ ${jwt.name} | Exp: ${jwt.exp} (${jwt.remaining})`;
    } else {
      hint = `\n\n❌ JWT: ${jwt.error || 'invalid'}`;
    }
    await bot.sendMessage(msg.chat.id, `❌ Gagal ambil data aktivitas.\n\n${e.message}${hint}`, mainMenu);
  }
});

// /relogin — trigger Playwright OIDC login for specified account
bot.onText(/^\/relogin\s+(\S+)/, async (msg, match) => {
  const code = match[1].toUpperCase();
  const acct = VAULT.getAccount(code);
  if (!acct) return bot.sendMessage(msg.chat.id, `❌ Akun ${code} tidak ditemukan.\nCek dengan /accounts.`);
  if (!acct.password || acct.password === 'NEED_PASSWORD') {
    return bot.sendMessage(msg.chat.id,
      `❌ Password untuk ${code} belum di-set.\n\n` +
      `Ketik /setpw ${code} <password> untuk simpan.`
    );
  }
  await bot.sendMessage(msg.chat.id,
    `🔄 Login Star [${code}]\n` +
    `Sedang proses...\n` +
    `Password: ✅ (dari vault)\n` +
    `Method   : Playwright + MFA push\n` +
    `Estimasi : 30-60 detik\n\n` +
    `Akan kirim notifikasi ke chat ini saat MFA diperlukan.`
  );
  try {
    const { spawn } = require('child_process');
    const loginPath = path.join(__dirname, 'login-star.js');
    const child = spawn('node', [loginPath, code, '--chat-id', msg.chat.id.toString()], {
      cwd: __dirname,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    console.log(`[/relogin] Started login-star.js for ${code}, pid=${child.pid}`);
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `❌ Gagal jalankan login: ${e.message}`);
  }
});

// /setpw — update password in vault
bot.onText(/^\/setpw\s+(\S+)\s+(.+)/, async (msg, match) => {
  const code = match[1].toUpperCase();
  const password = match[2];
  const acct = VAULT.getAccount(code);
  if (!acct) return bot.sendMessage(msg.chat.id, `❌ Akun ${code} tidak ditemukan.`);
  try {
    const fs2 = require('fs');
    const vaultPath = VAULT.VAULT_FILE;
    const vault = JSON.parse(fs2.readFileSync(vaultPath, 'utf8'));
    vault[code].password = password;
    vault[code].updatedAt = new Date().toISOString();
    fs2.writeFileSync(vaultPath, JSON.stringify(vault, null, 2));
    await bot.sendMessage(msg.chat.id, `✅ Password untuk ${code} tersimpan di vault.\n\nSekarang bisa pakai /relogin ${code} untuk dapat JWT.`);
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `❌ Gagal simpan password: ${e.message}`);
  }
});

// /use — switch active JWT
bot.onText(/^\/use\s+(\S+)/, async (msg, match) => {
  const code = match[1].toUpperCase();
  try {
    const main = VAULT.setActiveAccount(code);
    const st = VAULT.jwtStatus(code);
    const expStr = st.expiresAt ? new Date(st.expiresAt).toLocaleString('id-ID', {timeZone:'Asia/Makassar',hour12:false}) : '?';
    await bot.sendMessage(msg.chat.id,
      `✅ JWT ${code} jadi aktif.\nFile : ${main}\nExpires: ${expStr}`
    );
    // Restart bot to reload JWT
    await bot.sendMessage(msg.chat.id, `🔄 Merestart bot untuk load JWT baru...`);
    setTimeout(() => { require('child_process').execSync('systemctl --user restart prospek-bot'); }, 1500);
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `❌ Gagal switch: ${e.message}`);
  }
});

// ====== CALLBACK QUERIES ======
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const msgId = q.message.message_id;
  const data = q.data;
  const c = convGet(chatId) || {};
  await bot.answerCallbackQuery(q.id);

  // ── ACCOUNTS MENU (list all) ─────────────────────────────────────────────────
  if (data === 'accounts:menu') {
    const accounts = VAULT.listAccounts();
    return editMsg(chatId, msgId, formatAccountsList(accounts), buildAccountsMenuKeyboard(accounts));
  }

  // noop — separator label button
  if (data === 'noop') return;

  // accounts:detail:CODE — View account detail + actions
  if (data.startsWith('accounts:detail:')) {
    const code = data.split(':')[2];
    const a = VAULT.getAccount(code);
    if (!a) return editMsg(chatId, msgId, `❌ Akun tidak ditemukan.`, backBtn('accounts:menu'));
    const st = VAULT.getJwtStatus(code);
    const { emoji, label } = _s(st);
    const expStr = st.expiresAt
      ? new Date(st.expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Makassar', hour12: false })
      : '-';
    const lines = [
      '━━━━━━━━━━━━━━━━━━━━',
      `  🔑  DETAIL AKUN`,
      '━━━━━━━━━━━━━━━━━━━━',
      `  Kode     : ${code}`,
      `  Dealer   : ${a.dealerName || '-'}`,
      `  Email    : ${a.email}`,
      `  Password : ${a.password ? '✅ Tersimpan' : '❌ Belum ada'}`,
      '',
      `  Status   : ${emoji}  ${label}`,
      `  Expires  : ${expStr}`,
      '━━━━━━━━━━━━━━━━━━━━',
    ];
    return editMsg(chatId, msgId, lines.join('\n'), buildAccountDetailKeyboard(code));
  }

  // accounts:use:CODE — switch active JWT
  if (data.startsWith('accounts:use:')) {
    const code = data.split(':')[2];
    try {
      auditLog('switch_account', { chatId, code, msgId });
      VAULT.setActiveAccount(code);
      jwt = fs.readFileSync(JWT_FILE, 'utf8').trim();
      const st = VAULT.jwtStatus(code);
      const expStr = st.expiresAt ? new Date(st.expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Makassar', hour12: false }) : '?';
      await bot.sendMessage(chatId, `✅ JWT ${code} aktif. Expires: ${expStr}`);
      return editMsg(chatId, msgId, '👋 Menu Utama', mainMenu);
    } catch (e) {
      return editMsg(chatId, msgId, `❌ Gagal: ${e.message}`, backBtn('accounts:detail:' + code));
    }
  }

  // accounts:relogin:CODE — trigger login
  if (data.startsWith('accounts:relogin:')) {
    const code = data.split(':')[2];
    const acct = VAULT.getAccount(code);
    if (!acct || !acct.password) {
      return editMsg(chatId, msgId,
        `❌ Password untuk ${code} belum di-set.\n\nKlik ✏️ Edit Password untuk menambah.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '✏️ Edit Password', callback_data: 'accounts:edit_password:' + code }],
          [{ text: '⬅️ Kembali',       callback_data: 'accounts:detail:' + code }],
        ]}}
      );
    }
    await editMsg(chatId, msgId, `🔄 Login Star [${code}] — Sedang proses...`);
    try {
      const { spawn } = require('child_process');
      const child = spawn('node', [path.join(__dirname, 'login-star.js'), code, '--chat-id', chatId.toString()], {
        cwd: __dirname, detached: true, stdio: 'ignore',
      });
      child.unref();
    } catch (e) {
      return editMsg(chatId, msgId, `❌ Gagal: ${e.message}`, backBtn('accounts:detail:' + code));
    }
    return;
  }

  // accounts:edit:CODE — show edit menu
  if (data.startsWith('accounts:edit:')) {
    const code = data.split(':')[2];
    const a = VAULT.getAccount(code);
    const lines = [
      `✏️ Edit Akun: ${code}`,
      `Email    : ${a?.email || '-'}`,
      `Password : ${a?.password ? '✅' : '❌'}`,
      `Dealer   : ${a?.dealerName || '-'}`,
      '',
      'Pilih field yang ingin diedit:',
    ];
    return editMsg(chatId, msgId, lines.join('\n'), buildAccountEditKeyboard(code));
  }

  // accounts:edit_email:CODE
  if (data.startsWith('accounts:edit_email:')) {
    const code = data.split(':')[2];
    convSet(chatId, { step: 'wait_acct_edit_email', code });
    return editMsg(chatId, msgId, `✏️ *Edit Email — ${code}*\n\nKetik email baru:`, cancelBtn());
  }

  // accounts:edit_password:CODE
  if (data.startsWith('accounts:edit_password:')) {
    const code = data.split(':')[2];
    convSet(chatId, { step: 'wait_acct_edit_password', code });
    return editMsg(chatId, msgId, `🔑 *Edit Password — ${code}*\n\nKetik password baru:`, cancelBtn());
  }

  // accounts:edit_dealer:CODE
  if (data.startsWith('accounts:edit_dealer:')) {
    const code = data.split(':')[2];
    convSet(chatId, { step: 'wait_acct_edit_dealer', code });
    return editMsg(chatId, msgId, `🏪 *Edit Dealer — ${code}*\n\nKetik nama dealer:`, cancelBtn());
  }

  // accounts:delete:CODE — confirm delete
  if (data.startsWith('accounts:delete:')) {
    const code = data.split(':')[2];
    return editMsg(chatId, msgId,
      `⚠️ *Konfirmasi Hapus Akun*\n\nHapus \`${code}\` dari vault?\n_JWT file juga akan dihapus._`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '✅ Ya, Hapus', callback_data: 'accounts:delete_confirm:' + code }],
        [{ text: '⬅️ Batal',    callback_data: 'accounts:detail:' + code }],
      ]}}
    );
  }

  // accounts:delete_confirm:CODE
  if (data.startsWith('accounts:delete_confirm:')) {
    const code = data.split(':')[2];
    VAULT.removeAccount(code);
    return editMsg(chatId, msgId, `🗑️ Akun ${code} dihapus dari vault.`, backBtn('accounts:menu'));
  }

  // accounts:add:start
  if (data === 'accounts:add:start') {
    return editMsg(chatId, msgId,
      '➕ Tambah Akun Baru\n\nKlik Lanjut untuk mulai.',
      { reply_markup: { inline_keyboard: [
        [{ text: '✅ Lanjut', callback_data: 'accounts:add:code' }],
        [{ text: '⬅️ Batal',  callback_data: 'accounts:menu' }],
      ]}}
    );
  }

  // accounts:add:code — begin add flow
  if (data === 'accounts:add:code') {
    convSet(chatId, { step: 'wait_acct_code', action: 'add' });
    return editMsg(chatId, msgId, '📋 Tambah Akun — Langkah 1/4\n\nKetik KODE AKUN (misal: BUDI):', cancelBtn());
  }

  // --- CANCEL ---
  if (data === 'cancel') {
    conv.delete(chatId);
    return editMsg(chatId, msgId, '❌ Dibatalkan.', mainMenu);
  }

  // --- BACK TO MENU ---
  if (data === 'menu') {
    conv.delete(chatId);
    return editMsg(chatId, msgId, '👋 *Menu Utama*', mainMenu);
  }

  // --- STATUS ---
  if (data === 'status') {
    return editMsg(chatId, msgId, jwtInfo(), backBtn('menu'));
  }

  // --- SET JWT ---
  if (data === 'setjwt') {
    await editMsg(chatId, msgId,
      '🔑 *Set JWT Token*\n\nKirim token JWT:\n`/jwt <token>`', cancelBtn());
    convSet(chatId, { step: 'wait_jwt' });
    return;
  }

  // --- FF/EXCEL MENU ---
  if (data === 'ff:menu') {
    convSet(chatId, { step: 'ff_input' });
    return editMsg(chatId, msgId,
      '📊 *FF / Excel Input*\n\n' +
      'Kirim data dalam format:\n\n' +
      '```\n' +
      'individu NO NAMA LAKI-LAKI ALAMAT RT.00X KALIMANTAN TIMUR KABUPATEN PENAJAM PASER UTARA PENAJAM DESA RT RW LAKI-LAKI AGAMA PEKERJAAN HP tidak kredit KODEMOTOR\n' +
      '```\n\n' +
      'Contoh:\n' +
      '```\n' +
      'individu 3 AHMAD SAPAR LAKI-LAKI BULU MINUNG RT.001 KALIMANTAN TIMUR KABUPATEN PENAJAM PASER UTARA PENAJAM BULUMINUNG 001 000 LAKI-LAKI ISLAM LAIN-LAIN 081347313249 tidak kredit NE0B\n' +
      '```\n\n' +
      '💡 Kirim beberapa baris sekaligus untuk batch input!',
      cancelBtn());
  }

  // --- FF SUBMIT ALL ---
  if (data === 'ff:submit_all') {
    auditLog('ff_submit_all', { chatId });
    const s = convGet(chatId);
    if (!s || s.step !== 'ff_confirm' || !s.ff_data) {
      return editMsg(chatId, msgId, '❌ Session expired. Mulai ulang dari menu.', mainMenu);
    }
    
    const results = s.ff_data;
    const errors = s.ff_errors || [];
    
    // Confirm to user
    await editMsg(chatId, msgId, `⏳ *Memproses ${results.length} data...*\n\nIni akan memakan waktu beberapa saat.`, {});
    
    const success = [];
    const failed = [];
    
    for (const d of results) {
      try {
        // STRATEGY: fetch all, filter client-side by HP
        console.log('FF/Excel: fetching all prospects for dedup check...');
        const allData = await callStar(QRY_SEARCH);
        const allNodes = allData?.getCustomerProspectFromCustomers?.nodes || [];
        console.log('FF/Excel: total prospects fetched:', allNodes.length);
        const node = allNodes.find(n => n.mobilePhoneNumber === d.hp);
        if (node) {
          // HP sudah terdaftar — skip, jangan input ulang
          success.push({ nama: d.nama, prospectNumber: node.prospectNumber, duplicate: true });
          continue;
        }

        const currentLevel = s.ff_level || 'MEDIUM';
        const isLOW = currentLevel === 'LOW';
        const isHOT = currentLevel === 'HOT';

        // HP belum ada — create baru
        const body = {
          name: d.nama,
          mobilePhoneNumber: d.hp,
          customerType: 'REGULAR',
          gender: d.gender,
          testRidePreference: false,
          tagPriority: true,
          preferenceSalesType: d.statusKredit === 'KREDIT' ? 'CREDIT' : undefined,
          prospectStatus: 'PROSPECT', // Create as PROSPECT, upgrade via follow-up for all levels
          channelId: jwtChannelId(),
          channelName: jwtChannelName(),
          occupation: d.pekerjaan,
          religion: d.agama,
          birthPlace: 'PENAJAM',
          description: `FF/Excel - No.Urut: ${d.no}`,
        };

        // WILAYAH only for MEDIUM/HOT — LOW tidak perlu alamat/provinsi/dsb
        if (!isLOW) {
          body.provinceId = WILAYAH.provinceId;
          body.provinceName = WILAYAH.provinceName;
          body.districtId = WILAYAH.districtId;
          body.districtName = WILAYAH.districtName;
          body.subDistrictId = WILAYAH.subDistrictId;
          body.subDistrictName = WILAYAH.subDistrictName;
          body.villageId = WILAYAH.villageId;
          body.villageName = WILAYAH.villageName;
          body.postalCode = WILAYAH.postalCode;
          body.rT = d.rt;
          body.rW = d.rw;
          body.address = `${d.alamat}`;
        }

        // NIK only for HOT
        if (isHOT && d.nik && d.nik.length === 16) {
          body.iDNumber = d.nik;
        }

        // Asal Prospek (dari no urut: 1, 2, 3, 4, 5a, 5b, 6, 9a...)
        const asalKey = (d.no || '').toLowerCase().trim();
        const asalData = ASAL_PROSPEK[asalKey];
        if (asalData) {
          body.sourceOfProspectHsoId = asalData.id;
        }

        // Motor: pakai format "KODE-NAMA LENGKAP" (verified 2026-07-17)
        if (d.motor) {
          body.catalogueUnitDescription = `${d.motor.code}-${d.motor.name}`;
          body.catalogueUnitColorDescription = '-';
        }

        if (d.occupationHso) {
          body.occupationFirstHsoId = d.occupationHso.id;
          body.occupationFirstHsoName = d.occupationHso.name;
          body.occupationFirstHsoCode = d.occupationHso.code;
        }

        console.log('FF/Excel mutation body:', JSON.stringify(body));
        const result = await callStar(MUT_CREATE, { data: body });
        const prospect = result.ensureCreateCustomerProspectFromCustomers;

        // Follow-up — WAJIB untuk semua level agar muncul di /follup
        try {
          let followUpResult = currentLevel;
          let followUpDesc = 'FF/Excel - Minat motor, follow-up lanjut';
          if (isLOW) {
            followUpResult = 'LOW';
            followUpDesc = 'FF/Excel LOW - Kontak awal follow-up';
          } else if (isHOT) {
            followUpResult = 'HOT';
            followUpDesc = 'FF/Excel HOT - NIK lengkap, ready follow-up';
          }
          await callStar(MUT_FOLLOWUP, {
            input: {
              customerProspectId: prospect.id,
              followUpMethod: 'WA',
              followUpResult,
              description: followUpDesc,
              followUpDate: new Date().toISOString(),
            }
          });
        } catch (e) {
          console.log('Follow-up skip:', e.message);
        }

        success.push({ nama: d.nama, prospectNumber: prospect.prospectNumber });
        
      } catch (e) {
        console.error('FF/Excel create error:', e.message, '| data:', JSON.stringify({ nama: d.nama, hp: d.hp, no: d.no }));
        failed.push({ nama: d.nama, hp: d.hp, reason: e.message || 'Unknown error' });
      }
    }
    
    // Build result message — limit each section to avoid Telegram 4096 char limit
    const MAX_SUCC_DETAIL = 10;
    const MAX_FAIL_DETAIL = 5;
    const levelEmoji = s.ff_level === 'LOW' ? '🟢' : s.ff_level === 'HOT' ? '🔴' : '🟡';
    let resultTxt = `📊 *Hasil FF/Excel*   ${levelEmoji} ${s.ff_level || 'MEDIUM'}\n\n`;
    
    if (success.length > 0) {
      const newSucc = success.filter(s => !s.duplicate);
      const dups = success.filter(s => s.duplicate);
      resultTxt += `✅ *Berhasil baru: ${newSucc.length}*\n`;
      for (const s of newSucc.slice(0, MAX_SUCC_DETAIL)) {
        resultTxt += `• ${s.nama} → \`${s.prospectNumber}\`\n`;
      }
      if (newSucc.length > MAX_SUCC_DETAIL) {
        resultTxt += `  ... dan ${newSucc.length - MAX_SUCC_DETAIL} lainnya\n`;
      }
      if (dups.length > 0) {
        resultTxt += `\n🔄 *Sudah ada (duplicate): ${dups.length}*\n`;
        for (const s of dups.slice(0, MAX_SUCC_DETAIL)) {
          resultTxt += `• ${s.nama} → \`${s.prospectNumber}\`\n`;
        }
        if (dups.length > MAX_SUCC_DETAIL) {
          resultTxt += `  ... dan ${dups.length - MAX_SUCC_DETAIL} lainnya\n`;
        }
      }
      resultTxt += `\n`;
    }
    
    if (failed.length > 0) {
      resultTxt += `❌ *Gagal: ${failed.length}*\n`;
      for (const f of failed.slice(0, MAX_FAIL_DETAIL)) {
        resultTxt += `• ${f.nama} (${f.hp})\n  → ${f.reason}\n`;
      }
      if (failed.length > MAX_FAIL_DETAIL) {
        resultTxt += `  ... dan ${failed.length - MAX_FAIL_DETAIL} lainnya\n`;
      }
    }
    
    if (errors.length > 0) {
      resultTxt += `\n⚠️ *Parse Error: ${errors.length}*\n`;
      for (const e of errors.slice(0, 3)) {
        resultTxt += `• ${e.error}: \`${e.line}...\`\n`;
      }
    }
    
    conv.delete(chatId);
    return bot.sendMessage(chatId, resultTxt, { parse_mode: 'Markdown', ...mainMenu });
  }
  
  // --- FF CANCEL ---
  if (c && c.step && c.step.startsWith('ff_') && data === 'cancel') {
    conv.delete(chatId);
    return editMsg(chatId, msgId, '❌ FF/Excel dibatalkan.', mainMenu);
  }

  // --- CREATE PROSPEK ---
  if (data.startsWith('create:')) {
    const level = data.split(':')[1];
    if (!['LOW','MEDIUM','HOT'].includes(level)) return;
    const descs = { LOW: 'Nama + HP + Asal', MEDIUM: 'Nama + HP + Asal + Motor + Alamat', HOT: 'Nama + HP + Asal + Motor + NIK + Alamat' };
    convSet(chatId, { step: 'ask_name', level, data: {} });
    return editMsg(chatId, msgId,
      `📝 *Prospek ${level}*\nField: ${descs[level]}\n\nSilakan masukkan **nama lengkap customer**:`, cancelBtn());
  }

  // --- ASAL PROSPEK SELECTED ---
  if (data.startsWith('asal:')) {
    const s = convGet(chatId);
    if (!s || s.step !== 'ask_asal') return;
    const asalKey = data.split(':')[1];
    const asal = ASAL_PROSPEK[asalKey];
    if (!asal) return;
    s.data.asalId = asal.id;
    s.data.asalName = asal.name;
    s.data.asalKey = asalKey;
    convSet(chatId, s);
    
    // LOW: selesai, langsung preview
    if (s.level === 'LOW') {
      return showPreview(chatId, s);
    }
    // MEDIUM/HOT: pilih motor
    s.step = 'ask_motor';
    convSet(chatId, s);
    return editMsg(chatId, msgId, `📌 Asal: *${asal.name}*\n\n🏍 *Pilih TIPE MOTOR*:`, motorKeyboard());
  }

  // --- MOTOR SELECTED (via keyboard) ---
  if (data.startsWith('motor:')) {
    const s = convGet(chatId);
    if (!s || s.step !== 'ask_motor') return;
    const motorCode = data.split(':')[1];
    s.data.motorCode = motorCode;
    s.data.motorType = motorCode;
    convSet(chatId, s);
    
    // Lanjut occupation
    s.step = 'ask_occupation';
    convSet(chatId, s);
    return editMsg(chatId, msgId, `🏍 Motor: *${motorCode}*\n\n💼 Masukkan **pekerjaan** customer:\n(contoh: Pedagang, Petani, Wiraswasta, Ibu RT, Karyawan)`, cancelBtn());
  }

  // --- MOTOR LIST (show all available) ---
  if (data === 'motor:list') {
    const s = convGet(chatId);
    if (!s || s.step !== 'ask_motor') return;
    const motors = getMotorList();
    let txt = `🏍 *Daftar Kode Motor:*\n\n`;
    for (const m of motors) {
      txt += `• *${m.code}* - ${m.name}\n`;
    }
    txt += `\nKetik kode motor (misal: LY2, Vario 125):`;
    convSet(chatId, { ...s, step: 'ask_motor_text' });
    return editMsg(chatId, msgId, txt, cancelBtn());
  }

  // --- CONFIRM CREATE ---
  if (data === 'confirm') {
    const s = convGet(chatId);
    if (!s || !s.data || !s.data.name) return;
    const { name, phone, motorType, nik, address, occupation, asalId, asalName } = s.data;
    try {
      const result = await createProspek({
        name, phone, level: s.level,
        description: motorType ? `Tipe Motor: ${motorType}` : undefined,
        iDNumber: nik || undefined,
        address: address || undefined,
        motorType: motorType || undefined,
        occupation: occupation || 'Wiraswasta',
        gender: 'LAKI_LAKI',
        asalId,
      });
      let txt = `✅ *Prospek ${s.level} berhasil!*\n\n📌 \`${result.prospectNumber}\`\n👤 ${name}\n📞 ${phone}\n📌 Asal: *${asalName}*`;
      if (occupation) txt += `\n💼 ${occupation}`;
      if (motorType) txt += `\n🏍 ${motorType}`;
      if (nik) txt += `\n🆔 NIK: ${nik}`;
      if (address) txt += `\n📍 ${address}`;
      txt += `\n📊 *${result.prospectStatus}*`;
      conv.delete(chatId);
      return editMsg(chatId, msgId, txt, mainMenu);
    } catch (e) {
      return editMsg(chatId, msgId, `❌ *Gagal:* ${e.message}`, confirmBtn());
    }
  }

  // --- UPGRADE MENU ---
  if (data === 'upgrade:menu') {
    convSet(chatId, { step: 'upgrade_search' });
    return editMsg(chatId, msgId,
      '⬆️ *Upgrade Status Prospek*\n\nMasukkan nomor HP atau nama customer yang ingin di-upgrade:',
      cancelBtn());
  }

  // --- UPGRADE SELECT ---
  if (data.startsWith('upgrade:')) {
    const parts = data.split(':');
    if (parts.length < 3) return;
    const action = parts[1]; // 'select' or 'do'
    if (action === 'select') {
      const prospectId = parts[2];
      const status = parts[3];
      // Cari data prospek
      try {
        const result = await callStar(QRY_SEARCH);
        const node = result?.getCustomerProspectFromCustomers?.nodes?.find(n => n.id === prospectId);
        if (!node) return editMsg(chatId, msgId, '❌ Prospek tidak ditemukan.', backBtn('upgrade:menu'));
        
        const curStatus = node.prospectStatus;
        if (!VALID_UPGRADES[curStatus]?.includes(status)) {
          return editMsg(chatId, msgId,
            `❌ Tidak bisa upgrade *${curStatus}* → *${status}* (status tidak bisa turun).`, backBtn('upgrade:menu'));
        }
        
        // Konfirmasi
        const txt = `⬆️ *Konfirmasi Upgrade*\n\n📌 ${node.prospectNumber}\n👤 ${node.name}\n📞 ${node.mobilePhoneNumber}\n📊 ${curStatus} → *${status}*\n\nLanjutkan?`;
        convSet(chatId, { step: 'upgrade_confirm', prospectId, newStatus: status, curStatus });
        return editMsg(chatId, msgId, txt, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Ya, Upgrade', callback_data: 'upgrade:do' },
               { text: '⬅️ Batal', callback_data: 'cancel' }],
            ]
          }
        });
      } catch (e) {
        return editMsg(chatId, msgId, `❌ Error: ${e.message}`, backBtn('upgrade:menu'));
      }
    }
    if (action === 'do') {
      const s = convGet(chatId);
      if (!s?.prospectId) return;
      try {
        const result = await updateStatus(s.prospectId, s.newStatus);
        const r = result.ensureUpdateCustomerProspectStatusFromCustomers;
        if (s.newStatus === 'DEAL') {
          await bot.sendMessage(chatId, `🎉 *Selamat! Prospek DEAL!*\n📊 ${s.curStatus} → *DEAL*`);
        }
        const txt = `✅ *Status berhasil diupdate!*\n📊 ${s.curStatus} → *${r.prospectStatus}*`;
        conv.delete(chatId);
        return editMsg(chatId, msgId, txt, mainMenu);
      } catch (e) {
        return editMsg(chatId, msgId, `❌ Gagal: ${e.message}`, backBtn('upgrade:menu'));
      }
    }
  }

  // --- SEARCH ---
  if (data === 'search:menu') {
    convSet(chatId, { step: 'search' });
    return editMsg(chatId, msgId,
      '📋 *Cari Prospek*\n\nMasukkan nama atau nomor HP customer:',
      cancelBtn());
  }

  // --- SEARCH RESULT SELECT ---
  if (data.startsWith('search:select:')) {
    const prospectId = data.split(':')[2];
    try {
      const result = await callStar(QRY_SEARCH);
      const node = result?.getCustomerProspectFromCustomers?.nodes?.find(n => n.id === prospectId);
      if (!node) return editMsg(chatId, msgId, '❌ Tidak ditemukan.', backBtn('menu'));
      
      const curStatus = node.prospectStatus;
      const availableUpgrades = VALID_UPGRADES[curStatus] || [];
      
      let txt = `📋 *Detail Prospek*\n\n`;
      txt += `📌 \`${node.prospectNumber}\`\n`;
      txt += `👤 ${node.name}\n`;
      txt += `📞 ${node.mobilePhoneNumber}\n`;
      txt += `📊 *${curStatus}*\n`;
      if (node.iDNumber && node.iDNumber !== '-') txt += `🆔 NIK: ${node.iDNumber}\n`;
      if (node.address) txt += `📍 ${node.address}\n`;
      if (node.catalogueUnitColorDescription) txt += `🏍 ${node.catalogueUnitColorDescription}\n`;
      if (node.description) txt += `📝 ${node.description}\n`;
      txt += `📅 ${(node.created||'').slice(0,10)}\n`;
      
      if (availableUpgrades.length > 0) {
        txt += `\n*Upgrade ke:*`;
        const buttons = availableUpgrades.map(st => ({
          text: `➡️ ${curStatus} → ${st}`,
          callback_data: `upgrade:select:${prospectId}:${st}`
        }));
        const rows = [];
        for (let i = 0; i < buttons.length; i += 2) {
          rows.push(buttons.slice(i, i + 2));
        }
        rows.push([{ text: '⬅️ Kembali', callback_data: 'menu' }]);
        return editMsg(chatId, msgId, txt, { reply_markup: { inline_keyboard: rows } });
      } else {
        return editMsg(chatId, msgId, txt, backBtn('menu'));
      }
    } catch (e) {
      return editMsg(chatId, msgId, `❌ Error: ${e.message}`, backBtn('menu'));
    }
    return;
  }

  // =============================================
  // ====== BULK NOT DEAL HANDLERS ===============
  // =============================================

  // --- NOT DEAL MENU ---
  if (data === 'notdeal:menu') {
    convSet(chatId, { step: 'notdeal_status' });
    return editMsg(chatId, msgId,
      '🚫 *Bulk Not Deal*\n' +
      'Reason : *TIDAK_BERMINAT*\n' +
      '(auto-set, tidak bisa diubah)\n\n' +
      'Pilih *STATUS* prospek yang ingin di-NOT DEAL-kan:',
      notdealStatusKeyboard());
  }

  // --- NOT DEAL: STATUS SELECTED --- show preview & confirm
  if (data.startsWith('notdeal:status:')) {
    const targetStatus = data.split(':')[2]; // HOT, MEDIUM, LOW, or ALL
    const s = convGet(chatId) || {};
    s.notdeal_status = targetStatus;
    s.notdeal_reason = 'TIDAK_BERMINAT'; // hardcoded
    convSet(chatId, s);

    const reason = 'TIDAK_BERMINAT';
    const statusLabel = targetStatus === 'ALL' ? 'HOT + MEDIUM + LOW' : targetStatus;

    // Collect ALL prospect names per status (paginated, S0001-safe)
    const statuses = targetStatus === 'ALL' ? ['HOT', 'MEDIUM', 'LOW'] : [targetStatus];
    const counts = {};
    const allNames = { HOT: [], MEDIUM: [], LOW: [] };
    let totalCount = 0;

    try {
      for (const st of statuses) {
        let after = null;
        let hasMore = true;
        while (hasMore) {
          const cursorArg = after ? `, after: "${after}"` : '';
          const q = '{ getCustomerProspectFromCustomers(first: 10' + cursorArg + ', where: { prospectNumber: { startsWith: "H704-PRS" }, prospectStatus: { eq: ' + st + ' }, createdBy: { eq: "' + currentJwtUuid() + '" }, created: { gte: "2026-07-01T00:00:00Z", lte: "2026-07-31T23:59:59Z" } }) { nodes { id prospectNumber name prospectStatus } pageInfo { hasNextPage endCursor } } }';
          const d = callStar(q);
          const nodes = d.getCustomerProspectFromCustomers.nodes;
          const pi = d.getCustomerProspectFromCustomers.pageInfo;
          counts[st] = (counts[st] || 0) + nodes.length;
          totalCount += nodes.length;
          allNames[st].push(...nodes.map(n => n.name));
          hasMore = pi.hasNextPage;
          after = pi.endCursor;
          if (hasMore) await new Promise(r => setTimeout(r, 2000));
        }
      }
    } catch (e) {
      return editMsg(chatId, msgId, `❌ Gagal fetch prospects: ${e.message}`, backBtn('notdeal:menu'));
    }

    if (totalCount === 0) {
      return editMsg(chatId, msgId,
        `❌ Tidak ada prospek *${statusLabel}* untuk di-update.`,
        backBtn('notdeal:menu'));
    }

    // Build preview with names grouped by status
    let preview = `🚫 *Preview Bulk Not Deal*\\n\\n`;
    preview += `Reason : *${reason}*\\n`;
    preview += `Total  : *${totalCount}* prospects\\n`;
    if (targetStatus === 'ALL') {
      preview += `  ├ 🔥 HOT    : *${counts.HOT || 0}*\\n`;
      preview += `  ├ 🟡 MEDIUM : *${counts.MEDIUM || 0}*\\n`;
      preview += `  └ 🟢 LOW    : *${counts.LOW || 0}*\\n`;
    } else {
      preview += `  └ Status : *${statusLabel}*\\n`;
    }
    preview += `\\n─────────────────────`;
    if (targetStatus === 'ALL' || targetStatus === 'HOT') {
      if (allNames.HOT.length > 0) {
        preview += `\\n🔥 HOT (*${allNames.HOT.length}*)`;
        for (const n of allNames.HOT) preview += `\\n  ▸ ${n}`;
      }
    }
    if (targetStatus === 'ALL' || targetStatus === 'MEDIUM') {
      if (allNames.MEDIUM.length > 0) {
        preview += `\\n🟡 MEDIUM (*${allNames.MEDIUM.length}*)`;
        for (const n of allNames.MEDIUM) preview += `\\n  ▸ ${n}`;
      }
    }
    if (targetStatus === 'ALL' || targetStatus === 'LOW') {
      if (allNames.LOW.length > 0) {
        preview += `\\n🟢 LOW (*${allNames.LOW.length}*)`;
        for (const n of allNames.LOW) preview += `\\n  ▸ ${n}`;
      }
    }
    preview += `\\n─────────────────────\\n`;
    preview += `⚠️ SEMUA prospek akan menjadi *LOST*.\\n`;
    preview += `Proses ini TIDAK bisa di-undo.\\n\\n`;
    preview += `Ketik *YA* untuk konfirmasi, atau *BATAL*.`;

    // Save allNames to session so execute can reuse for result report
    convSet(chatId, { ...s, step: 'notdeal_confirm', _ndNames: allNames, _ndCounts: counts, _ndTotal: totalCount });

    convSet(chatId, { ...s, step: 'notdeal_confirm' });
    return editMsg(chatId, msgId, preview, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ YA, PROSES SEKARANG', callback_data: 'notdeal:do' }],
          [{ text: '⬅️ Batal', callback_data: 'cancel' }],
        ]
      }
    });
  }

  // --- NOT DEAL: EXECUTE ---
  if (data === 'notdeal:do') {
    const s = convGet(chatId) || {};
    if (!s.notdeal_reason) return editMsg(chatId, msgId, '❌ Session expired.', mainMenu);

    const reason = 'TIDAK_BERMINAT';
    const targetStatus = s.notdeal_status;
    const statuses = targetStatus === 'ALL' ? ['HOT', 'MEDIUM', 'LOW'] : [targetStatus];
    const statusLabel = targetStatus === 'ALL' ? 'HOT + MEDIUM + LOW' : targetStatus;
    const allNames = s._ndNames || { HOT: [], MEDIUM: [], LOW: [] };
    const counts = s._ndCounts || {};

    await bot.answerCallbackQuery(q.id, { text: '⏳ Memproses... Processing...' });
    auditLog('notdeal_confirm', { chatId, status: s.notdeal_status, counts });

    const MUT_ND = `mutation UpdateStatus($data: UpdateCustomerProspectStatusInputFromCustomers!) {
      ensureUpdateCustomerProspectStatusFromCustomers(input: $data) { id name prospectStatus }
    }`;

    let totalOk = 0, totalFail = 0, totalSkipped = 0;
    const failedList = [];
    const okHot = [], okMed = [], okLow = [];

    for (const st of statuses) {
      let after = null;
      let hasMore = true;

      while (hasMore) {
        try {
          const cursorArg = after ? `, after: "${after}"` : '';
          const q = '{ getCustomerProspectFromCustomers(first: 10' + cursorArg + ', where: { prospectNumber: { startsWith: "H704-PRS" }, prospectStatus: { eq: ' + st + ' }, createdBy: { eq: "' + currentJwtUuid() + '" }, created: { gte: "2026-07-01T00:00:00Z", lte: "2026-07-31T23:59:59Z" } }) { nodes { id prospectNumber name prospectStatus } pageInfo { hasNextPage endCursor } } }';
          const d = callStar(q);
          const nodes = d.getCustomerProspectFromCustomers.nodes;
          const pi = d.getCustomerProspectFromCustomers.pageInfo;

          if (nodes.length === 0) { hasMore = false; break; }

          for (const p of nodes) {
            if (p.prospectStatus === 'LOST' || p.prospectStatus === 'DEAL') {
              totalSkipped++; continue;
            }
            try {
              callStar(MUT_ND, { data: { customerProspectId: p.id, prospectStatus: 'LOST', reasonNotDeal: reason } });
              totalOk++;
              if (st === 'HOT') okHot.push(p.name);
              else if (st === 'MEDIUM') okMed.push(p.name);
              else okLow.push(p.name);
            } catch (e) {
              totalFail++;
              if (failedList.length < 5) failedList.push(`${p.name}: ${e.message}`);
            }
            await new Promise(r => setTimeout(r, 3000));
          }

          hasMore = pi.hasNextPage;
          after = pi.endCursor;

          if (!pi.hasNextPage) { hasMore = false; break; }
        } catch (e) {
          return editMsg(chatId, msgId, `❌ Error fetch ${st}: ${e.message}`, mainMenu);
        }
      }
    }

    conv.delete(chatId);

    let resultTxt = `✅ *Bulk Not Deal — SELESAI*\\n\\n`;
    resultTxt += `Reason : *${reason}*\\n`;
    resultTxt += `─────────────────────\\n`;
    resultTxt += `✅ OK      : *${totalOk}*\\n`;
    if (totalSkipped > 0) resultTxt += `⏭️ Skip    : *${totalSkipped}*\\n`;
    if (totalFail > 0) resultTxt += `❌ Gagal   : *${totalFail}*\\n`;
    resultTxt += `─────────────────────`;

    if (okHot.length > 0) {
      resultTxt += `\\n🔥 HOT → LOST (*${okHot.length}*)`;
      for (const n of okHot) resultTxt += `\\n  ▸ ${n}`;
    }
    if (okMed.length > 0) {
      resultTxt += `\\n🟡 MEDIUM → LOST (*${okMed.length}*)`;
      for (const n of okMed) resultTxt += `\\n  ▸ ${n}`;
    }
    if (okLow.length > 0) {
      resultTxt += `\\n🟢 LOW → LOST (*${okLow.length}*)`;
      for (const n of okLow) resultTxt += `\\n  ▸ ${n}`;
    }
    if (failedList.length > 0) {
      resultTxt += `\\n─────────────────────\\n`;
      resultTxt += `⚠️ Gagal (*${totalFail}*):\\n`;
      for (const f of failedList) resultTxt += `  ▸ ${f}\\n`;
    }
    resultTxt += `\\n─────────────────────\\n`;
    resultTxt += `_Diupdate oleh @Rd_prospek_bot_`;
    return bot.sendMessage(chatId, resultTxt, { parse_mode: 'Markdown', ...mainMenu });
  }
});

// ====== DOCUMENT HANDLER (Excel/CSV) ======
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const doc = msg.document;
  
  if (!doc) return;
  
  // Check file type
  const fileName = doc.file_name || '';
  
  if (!fileName.match(/\.(xlsx|xls|csv|txt)$/i)) {
    return bot.sendMessage(chatId, '❌ File tidak dikenali. Kirim file .xlsx, .xls, .csv, atau .txt');
  }
  
  try {
    // Download file
    const file = await bot.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${TG_TOKEN}/${file.file_path}`;
    
    await bot.sendMessage(chatId, `📥 Mendownload file ${fileName}...`);
    
    // Fetch file content
    const response = await fetch(fileUrl);
    
    const isExcel = fileName.match(/\.(xlsx|xls)$/i);
    let lines = [];
    let detectedLevel = 'MEDIUM';
    let levelEmoji = '🟡';
    
    if (isExcel) {
      // Parse Excel binary file using XLSX library
      const buffer = await response.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      
      // Find the sheet with prospek data (prefer MEDIUM sheet)
      let ws = workbook.Sheets['MEDIUM'];
      if (!ws) {
        // Find first sheet with 'Nama' header
        for (const sheetName of workbook.SheetNames) {
          const testWs = workbook.Sheets[sheetName];
          const range = XLSX.utils.decode_range(testWs['!ref'] || 'A1');
          if (range.e.r >= 1) {
            const headers = [];
            for (let C = range.s.c; C <= range.e.c; C++) {
              const addr = XLSX.utils.encode_cell({ r: 0, c: C });
              headers.push(testWs[addr]?.v?.toString().toLowerCase() || '');
            }
            if (headers.includes('nama') || headers.includes('jenissales')) {
              ws = testWs;
              break;
            }
          }
        }
      }
      
      if (!ws) {
        return bot.sendMessage(chatId, '❌ Sheet data tidak ditemukan. Pastikan ada sheet dengan kolom Nama.');
      }
      
      // Parse rows
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      const headers = [];
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c: C });
        headers.push(ws[addr]?.v?.toString().toLowerCase().trim() || '');
      }
      
      // Normalize header by removing spaces and lowercasing
      const normalizeHeader = (h) => h.replace(/\s+/g, '').toLowerCase();
      const headersNorm = headers.map(normalizeHeader);
      
      // Find column indices (normalize to match)
      const idx = (name) => headersNorm.indexOf(name.replace(/\s+/g, '').toLowerCase());
      
      const colMap = {
        jenis: idx('jenissales'),
        kodeAsal: idx('kodeasalprospek'),
        nama: idx('nama'),
        gender: idx('gender'),
        alamat: idx('alamat'),
        provinsi: idx('kodeprovinsi'),
        kota: idx('kodekota'),
        kecamatan: idx('kecamatan'),
        kelurahan: idx('kelurahan'),
        rt: idx('rt'),
        rw: idx('rw'),
        agama: idx('agama'),
        pekerjaan: idx('pekerjaan'),
        hp: idx('nomorhp'),
        tesRide: idx('preferensitesride'),
        payment: idx('prefrensipembelian'),
        motor: idx('tipemotor'),
        nik: idx('nik') >= 0 ? idx('nik') : idx('nomornik'),
      };
      
      // Detect level from columns:
      // HOT = punya NIK (16 digit)
      // MEDIUM = punya alamat/provinsi/motor (tanpa NIK)
      // LOW = hanya kolom dasar (jenis, kodeAsal, nama, gender, hp)
      const hasNik = colMap.nik >= 0;
      const hasMediumCols = colMap.alamat >= 0 || colMap.provinsi >= 0 || colMap.kota >= 0
                         || colMap.kecamatan >= 0 || colMap.rt >= 0 || colMap.motor >= 0;
      if (hasNik) {
        detectedLevel = 'HOT';
        levelEmoji = '🔴';
      } else if (hasMediumCols) {
        detectedLevel = 'MEDIUM';
        levelEmoji = '🟡';
      } else {
        detectedLevel = 'LOW';
        levelEmoji = '🟢';
      }
      
      // Build text lines from Excel rows — now uses PIPE format
      for (let R = range.s.r + 1; R <= range.e.r; R++) {
        const row = {};
        for (const [key, C] of Object.entries(colMap)) {
          if (C >= 0) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            let val = ws[addr]?.v;
            if (val !== undefined && val !== null) {
              if (typeof val === 'number') val = String(val);
              row[key] = val.toString().trim();
            }
          }
        }
        
        // Only process 'individu' type
        if (row.jenis && row.jenis.toLowerCase() === 'individu') {
          // Extract RT/RW from address (more reliable than spreadsheet column)
          const addrText = (row.alamat || '');
          const rtMatch = addrText.match(/RT\.?\s*0*(\d+)/i);
          const rwMatch = addrText.match(/RW\.?\s*0*(\d+)/i);
          const rtFromCol = row.rt ? parseInt(String(row.rt).replace(/\D/g,''), 10) : 0;
          const rwFromCol = row.rw ? parseInt(String(row.rw).replace(/\D/g,''), 10) : 0;
          const rtVal = rtMatch ? String(rtMatch[1]) : (rtFromCol ? String(rtFromCol) : '1');
          const rwVal = rwMatch ? String(rwMatch[1]) : (rwFromCol ? String(rwFromCol) : '0');

          // Detect HOT format: has NIK column between kodeAsal and nama
        const isHotFormat = colMap.nik >= 0;
        
        // Pipe-separated output — adapts to HOT format if NIK present
        // HOT: jenis|no|nama|alamat|prov|kota|kecamatan|desa|rt|rw|gender|agama|pekerjaan|hp|status|bayar|motor|nik
        // MEDIUM: jenis|no|nama|alamat|prov|kota|kecamatan|desa|rt|rw|gender|agama|pekerjaan|hp|status|bayar|motor
        const pipeParts = [];
        pipeParts.push(row.jenis);                          // 0: individu
        pipeParts.push(row.kodeAsal || '3');                 // 1: no/kode asal
        pipeParts.push(row.nama || '');                      // 2: NAMA (index shifts in HOT format)
        pipeParts.push(row.alamat || '');                    // 3: ALAMAT
        pipeParts.push(row.provinsi || 'KALIMANTAN TIMUR');  // 4: PROVINSI
        pipeParts.push(row.kota || '');                      // 5: KABUPATEN
        pipeParts.push(row.kecamatan || 'PENAJAM');          // 6: KECAMATAN
        pipeParts.push(row.kelurahan || 'PENAJAM');          // 7: DESA
        pipeParts.push(rtVal);                               // 8: RT
        pipeParts.push(rwVal);                               // 9: RW
        pipeParts.push(row.gender || 'LAKI-LAKI');           // 10: GENDER
        pipeParts.push(row.agama || 'ISLAM');                // 11: AGAMA
        pipeParts.push(row.pekerjaan || 'LAIN-LAIN');        // 12: PEKERJAAN
        pipeParts.push(row.hp || '');                        // 13: HP
        pipeParts.push(row.tesRide || 'tidak');              // 14: STATUS
        pipeParts.push(row.payment || 'tunai');              // 15: BAYAR
        pipeParts.push(row.motor || '');                     // 16: KODE MOTOR
        pipeParts.push(row.nik || '');                       // 17: NIK (HOT format)
        
        lines.push(pipeParts.join('|'));
        }
      }
    } else {
      // CSV/TXT - read as text
      const content = await response.text();
      lines = content.split('\n').filter(l => l.trim().length > 0);
    }
    
    // Parse lines
    const results = [];
    const errors = [];
    for (const line of lines) {
      if (!line.toLowerCase().startsWith('individu')) continue;
      const parsed = parseIndividuLine(line);
      if (!parsed.success) {
        errors.push({ line: line.slice(0, 60), error: parsed.error });
        continue;
      }
      results.push(parsed.data);
    }
    
    if (results.length === 0) {
      return bot.sendMessage(chatId,
        `❌ *Gagal parse data*\n\nFile tidak mengandung format "individu".`,
        { parse_mode: 'Markdown' });
    }
    
    // Resolve level: Excel uses column detection (set above); CSV/TXT uses data heuristic
    if (!isExcel) {
      const isLowData = results.every(d => (!d.motor || !d.motor.code) && (!d.alamat || d.alamat === 'PENAJAM'));
      detectedLevel = isLowData ? 'LOW' : 'MEDIUM';
      levelEmoji = detectedLevel === 'LOW' ? '🟢' : '🟡';
    }
    // For Excel: detectedLevel & levelEmoji already set inside the isExcel block above
    
    // Show preview — limit to first 5 details to avoid Telegram 4096 char limit
    const MAX_PREVIEW = 5;
    const showCount = Math.min(results.length, MAX_PREVIEW);
    let replyTxt = `📊 *Preview dari File* — ${results.length} data    ${levelEmoji} ${detectedLevel}\n\n`;

    for (let i = 0; i < showCount; i++) {
      const d = results[i];
      const isLOW = detectedLevel === 'LOW';
      const motorText = d.motor ? `🏍 ${d.motor.name}` : (isLOW ? '' : '⚠️ Kode motor tidak dikenali');
      const occText = d.occupationHso ? d.occupationHso.name : d.pekerjaan;
      const creditText = d.statusKredit === 'KREDIT' ? '🔴 Kredit' : '🟢 Tunai';

      replyTxt += `─────────────────\n`;
      replyTxt += `*#${d.no} — ${d.nama}*\n`;
      replyTxt += `👤 ${d.gender === 'LAKI_LAKI' ? 'Laki-laki' : 'Perempuan'} | ${d.agama}\n`;
      if (!isLOW) replyTxt += `📍 ${d.alamat}, RT ${d.rt}/RW ${d.rw}\n`;
      replyTxt += `📞 ${d.hp}\n`;
      if (!isLOW) replyTxt += `${motorText} | ${creditText}\n`;
      else replyTxt += `${creditText}\n`;
      replyTxt += `💼 ${occText}\n`;
    }
    
    if (results.length > MAX_PREVIEW) {
      replyTxt += `\n... dan ${results.length - MAX_PREVIEW} data lainnya\n`;
    }
    replyTxt += `\n─────────────────\n`;
    replyTxt += `✅ ${results.length} data siap diproses\n`;
    replyTxt += `⚠️ ${errors.length} parse error\n\n`;
    replyTxt += `💡 Klik *Kirim* untuk submit ke Star API`;
    
    convSet(chatId, { step: 'ff_confirm', ff_data: results, ff_errors: errors, ff_level: detectedLevel });
    
    return bot.sendMessage(chatId, replyTxt, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `✅ Kirim Semua (${results.length})`, callback_data: 'ff:submit_all' }],
          [{ text: '❌ Batal', callback_data: 'cancel' }],
        ]
      }
    });
    
  } catch (e) {
    console.error('Document error:', e);
    return bot.sendMessage(chatId, `❌ Gagal membaca file: ${e.message}`);
  }
});

// ====== TEXT INPUT HANDLER ======
bot.on('message', async (msg) => {
  if (!msg.text) return;
  const text = msg.text.trim();
  if (text.startsWith('/')) return; // commands handled above
  const chatId = msg.chat.id;
  const s = convGet(chatId);
  if (!s) return;

  // --- FF/EXCEL INPUT ---
  if (s.step === 'ff_input') {
    // Split by newlines for batch
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const results = [];
    const errors = [];
    
    for (const line of lines) {
      const parsed = parseIndividuLine(line);
      if (!parsed.success) {
        errors.push({ line: line.slice(0, 50), error: parsed.error });
        continue;
      }
      results.push(parsed.data);
    }
    
    if (results.length === 0) {
      return bot.sendMessage(chatId,
        `❌ *Gagal parse semua data*\n\n` +
        errors.map(e => `• ${e.error}: \`${e.line}...\``).join('\n'),
        { parse_mode: 'Markdown', ...cancelBtn() });
    }
    
    // Detect level from data: LOW jika alamat default & tidak ada motor
    const isLowData = results.every(d => (!d.motor || !d.motor.code) && (!d.alamat || d.alamat === 'PENAJAM'));
    const detectedLevel = isLowData ? 'LOW' : 'MEDIUM';
    const levelEmoji = detectedLevel === 'LOW' ? '🟢' : '🟡';
    
    // Show preview for each
    let replyTxt = `📊 *Preview FF/Excel* — ${results.length} data    ${levelEmoji} ${detectedLevel}\n\n`;
    
    for (let i = 0; i < results.length; i++) {
      const d = results[i];
      const isLOW = detectedLevel === 'LOW';
      const motorText = d.motor ? `🏍 ${d.motor.name}` : (isLOW ? '' : '⚠️ Kode motor tidak dikenali');
      const occText = d.occupationHso ? d.occupationHso.name : d.pekerjaan;
      const creditText = d.statusKredit === 'KREDIT' ? '🔴 Kredit' : '🟢 Tunai';
      
      replyTxt += `─────────────────\n`;
      replyTxt += `*#${d.no} — ${d.nama}*\n`;
      replyTxt += `👤 ${d.gender === 'LAKI_LAKI' ? 'Laki-laki' : 'Perempuan'} | ${d.agama}\n`;
      if (!isLOW) replyTxt += `📍 ${d.alamat}, RT ${d.rt}/RW ${d.rw}, ${d.pekerjaan}\n`;
      replyTxt += `📞 ${d.hp}\n`;
      if (!isLOW) replyTxt += `${motorText} | ${creditText}\n`;
      else replyTxt += `${creditText}\n`;
      replyTxt += `💼 ${occText}\n`;
    }
    
    replyTxt += `\n─────────────────\n`;
    replyTxt += `✅ ${results.length} data siap diproses\n`;
    replyTxt += `⚠️ ${errors.length} error`;
    
    // Save to session for confirmation
    convSet(chatId, { step: 'ff_confirm', ff_data: results, ff_errors: errors, ff_level: detectedLevel });
    
    return bot.sendMessage(chatId, replyTxt, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `✅ Kirim Semua (${results.length})`, callback_data: 'ff:submit_all' }],
          [{ text: '❌ Batal', callback_data: 'cancel' }],
        ]
      }
    });
  }

  // --- FF/EXCEL AUTO-DETECT (anytime) ---
  if (!s && text.toLowerCase().startsWith('individu') && text.split('\n').some(l => l.trim().toLowerCase().startsWith('individu'))) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const results = [];
    const errors = [];
    
    for (const line of lines) {
      const parsed = parseIndividuLine(line);
      if (!parsed.success) {
        errors.push({ line: line.slice(0, 60), error: parsed.error });
        continue;
      }
      results.push(parsed.data);
    }
    
    if (results.length === 0) {
      return bot.sendMessage(chatId,
        `❌ *Gagal parse data*\n\n` +
        errors.map(e => `• ${e.error}: \`${e.line}...\``).join('\n'),
        { parse_mode: 'Markdown' });
    }
    
    // Detect level from data: LOW jika alamat default & tidak ada motor
    const isLowData = results.every(d => (!d.motor || !d.motor.code) && (!d.alamat || d.alamat === 'PENAJAM'));
    const detectedLevel = isLowData ? 'LOW' : 'MEDIUM';
    const levelEmoji = detectedLevel === 'LOW' ? '🟢' : '🟡';
    
    // Show preview
    let replyTxt = `📊 *Preview FF/Excel* — ${results.length} data    ${levelEmoji} ${detectedLevel}\n\n`;
    
    for (const d of results) {
      const isLOW = detectedLevel === 'LOW';
      const motorText = d.motor ? `🏍 ${d.motor.name}` : (isLOW ? '' : '⚠️ Kode motor tidak dikenali');
      const occText = d.occupationHso ? d.occupationHso.name : d.pekerjaan;
      const creditText = d.statusKredit === 'KREDIT' ? '🔴 Kredit' : '🟢 Tunai';
      
      replyTxt += `─────────────────\n`;
      replyTxt += `*#${d.no} — ${d.nama}*\n`;
      replyTxt += `👤 ${d.gender === 'LAKI_LAKI' ? 'Laki-laki' : 'Perempuan'} | ${d.agama}\n`;
      if (!isLOW) replyTxt += `📍 ${d.alamat}, RT ${d.rt}/RW ${d.rw}\n`;
      replyTxt += `📞 ${d.hp}\n`;
      if (!isLOW) replyTxt += `${motorText} | ${creditText}\n`;
      else replyTxt += `${creditText}\n`;
      replyTxt += `💼 ${occText}\n`;
    }
    
    replyTxt += `\n─────────────────\n`;
    replyTxt += `✅ ${results.length} data siap diproses\n`;
    replyTxt += `⚠️ ${errors.length} parse error\n\n`;
    replyTxt += `💡 Klik *Kirim* untuk submit ke Star API`;
    
    convSet(chatId, { step: 'ff_confirm', ff_data: results, ff_errors: errors, ff_level: detectedLevel });
    
    return bot.sendMessage(chatId, replyTxt, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `✅ Kirim Semua (${results.length})`, callback_data: 'ff:submit_all' }],
          [{ text: '❌ Batal', callback_data: 'cancel' }],
        ]
      }
    });
  }

  // --- CREATE FLOW: name ---
  if (s.step === 'ask_name') {
    if (text.length < 2) return bot.sendMessage(chatId, '❌ Nama terlalu pendek. Minimal 2 karakter.');
    s.data.name = text;
    s.step = 'ask_phone';
    convSet(chatId, s);
    return promptMsg(chatId, `👤 Nama: *${text}*\n\n📞 Masukkan **nomor HP** (628xxx):`, cancelBtn());
  }

  // --- CREATE FLOW: phone ---
  if (s.step === 'ask_phone') {
    let phone = text.replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '62' + phone.slice(1);
    if (phone.length < 10) return bot.sendMessage(chatId, '❌ Nomor tidak valid. Minimal 10 digit (628xxx).');
    s.data.phone = phone;
    s.step = 'ask_asal';
    convSet(chatId, s);
    return bot.sendMessage(chatId, `📞 HP: ${phone}\n\n📌 *Pilih ASAL PROSPEK*:`, asalKeyboard());
  }

  // --- CREATE FLOW: occupation (MEDIUM/HOT) ---
  if (s.step === 'ask_occupation') {
    if (text.length < 2) return bot.sendMessage(chatId, '❌ Pekerjaan terlalu pendek.');
    s.data.occupation = text;
    
    if (s.level === 'MEDIUM') {
      s.step = 'ask_address';
      convSet(chatId, s);
      return promptMsg(chatId, `💼 Pekerjaan: *${text}*\n\n📍 Masukkan **alamat** (nama jalan, no rumah):`, cancelBtn());
    }
    // HOT: lanjut NIK dulu
    s.step = 'ask_nik';
    convSet(chatId, s);
    return promptMsg(chatId, `💼 Pekerjaan: *${text}*\n\n🆔 Masukkan **NIK** (16 digit):`, cancelBtn());
  }

  // --- CREATE FLOW: motor input text (MEDIUM/HOT) ---
  if (s.step === 'ask_motor' || s.step === 'ask_motor_text') {
    const motor = validateMotorCode(text);
    if (!motor.valid) {
      return bot.sendMessage(chatId, '❌ Kode motor tidak valid.\nGunakan format: LY2, MF2, Vario125, dll', cancelBtn());
    }
    s.data.motorCode = motor.code;
    s.data.motorType = motor.name;
    s.step = 'ask_occupation';
    convSet(chatId, s);
    return promptMsg(chatId, `🏍 Motor: *${motor.name}*\n\n💼 Masukkan **pekerjaan** customer:\n(contoh: Pedagang, Petani, Wiraswasta, Ibu RT, Karyawan)`, cancelBtn());
  }

  // --- CREATE FLOW: NIK (HOT) ---
  if (s.step === 'ask_nik') {
    const nik = text.replace(/[^0-9]/g, '');
    if (nik.length < 16) return bot.sendMessage(chatId, '❌ NIK harus 16 digit.');
    s.data.nik = nik;
    s.step = 'ask_address';
    convSet(chatId, s);
    return promptMsg(chatId, `🆔 NIK: ${nik}\n\n📍 Masukkan **alamat** customer:`, cancelBtn());
  }

  // --- CREATE FLOW: address (MEDIUM/HOT) ---
  if (s.step === 'ask_address') {
    if (text.length < 5) return bot.sendMessage(chatId, '❌ Alamat terlalu pendek.');
    s.data.address = text;
    return showPreview(chatId, s);
  }

  // --- UPGRADE SEARCH ---
  if (s.step === 'upgrade_search') {
    const query = text;
    try {
      const result = await callStar(QRY_SEARCH);
      const allNodes = result?.getCustomerProspectFromCustomers?.nodes || [];
      const q = query.toLowerCase();
      const nodes = allNodes.filter(n =>
        n.name.toLowerCase().includes(q) ||
        n.mobilePhoneNumber.includes(query)
      ).slice(0, 10);
      if (nodes.length === 0) {
        return bot.sendMessage(chatId, '❌ Tidak ada prospek ditemukan. Coba nama/HP lain.', cancelBtn());
      }
      // Show list to select
      let txt = `⬆️ *Pilih prospek untuk di-upgrade:*\n\n`;
      const buttons = [];
      for (const p of nodes) {
        txt += `▪️ \`${p.prospectNumber}\` — ${p.name} (${p.prospectStatus})\n`;
        buttons.push([{ text: `${p.name} — ${p.prospectStatus}`, callback_data: `search:select:${p.id}` }]);
      }
      buttons.push([{ text: '⬅️ Cari Lagi', callback_data: 'upgrade:menu' }, { text: '🏠 Menu', callback_data: 'menu' }]);
      convSet(chatId, { step: 'upgrade_select' });
      return bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: buttons } });
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Error: ${e.message}`, cancelBtn());
    }
  }

  // --- SEARCH ---
  if (s.step === 'search') {
    const query = text;
    try {
      const result = await callStar(QRY_SEARCH);
      const allNodes = result?.getCustomerProspectFromCustomers?.nodes || [];
      const q = query.toLowerCase();
      const nodes = allNodes.filter(n =>
        n.name.toLowerCase().includes(q) ||
        n.mobilePhoneNumber.includes(query)
      ).slice(0, 10);
      if (nodes.length === 0) {
        return bot.sendMessage(chatId, '❌ Tidak ditemukan.', cancelBtn());
      }
      let txt = `📋 *Hasil pencarian:*\n\n`;
      const buttons = [];
      for (const p of nodes) {
        txt += `▪️ \`${p.prospectNumber}\`\n  ${p.name} — ${p.prospectStatus}\n`;
        buttons.push([{ text: `${p.name} (${p.prospectStatus})`, callback_data: `search:select:${p.id}` }]);
      }
      buttons.push([{ text: '🏠 Menu', callback_data: 'menu' }]);
      convSet(chatId, { step: 'search_result' });
      return bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: buttons } });
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Error: ${e.message}`, cancelBtn());
    }
  }

  // ── Account add/edit conversation handlers ─────────────────────────────────
  if (s.step === 'wait_acct_code') {
    const code = text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return bot.sendMessage(chatId, '❌ Kode tidak valid.', cancelBtn());
    if (VAULT.getAccount(code)) return bot.sendMessage(chatId, `❌ Kode ${code} sudah ada. Gunakan kode lain.`, cancelBtn());
    convSet(chatId, { step: 'wait_acct_email', code, action: 'add' });
    return bot.sendMessage(chatId, `📋 Akun: ${code}\n\nKetik EMAIL akun:`, cancelBtn());
  }
  if (s.step === 'wait_acct_email' && s.action === 'add') {
    const email = text.trim();
    if (!email.includes('@')) return bot.sendMessage(chatId, '❌ Email tidak valid.', cancelBtn());
    convSet(chatId, { step: 'wait_acct_password', code: s.code, email, action: 'add' });
    return bot.sendMessage(chatId, `📧 Email: ${email}\n\nKetik PASSWORD Star API:`, cancelBtn());
  }
  if (s.step === 'wait_acct_password' && s.action === 'add') {
    const password = text.trim();
    if (!password) return bot.sendMessage(chatId, '❌ Password tidak boleh kosong.', cancelBtn());
    convSet(chatId, { step: 'wait_acct_dealer', code: s.code, email: s.email, password, action: 'add' });
    return bot.sendMessage(chatId, `🔑 Password tersimpan.\n\nKetik NAMA DEALER:`, cancelBtn());
  }
  if (s.step === 'wait_acct_dealer' && s.action === 'add') {
    const dealerName = text.trim();
    if (!dealerName) return bot.sendMessage(chatId, '❌ Nama dealer tidak boleh kosong.', cancelBtn());
    try {
      VAULT.addAccount(s.code, { email: s.email, password: s.password, dealerName, createdAt: new Date().toISOString(), createdBy: 'bot' });
      conv.delete(chatId);
      return bot.sendMessage(chatId,
        `✅ Akun ${s.code} ditambahkan!\n\nDealer: ${dealerName}\n\nKlik Lihat Akun atau Relogin untuk dapat JWT.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '👀 Lihat Akun', callback_data: 'accounts:menu' }],
          [{ text: '🔙 Menu Utama', callback_data: 'menu' }],
        ]}}
      );
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Gagal: ${e.message}`, cancelBtn());
    }
  }
  if (s.step === 'wait_acct_edit_email') {
    const email = text.trim();
    if (!email.includes('@')) return bot.sendMessage(chatId, '❌ Email tidak valid.', cancelBtn());
    try {
      const vault = JSON.parse(fs.readFileSync(VAULT.VAULT_FILE, 'utf8'));
      vault[s.code].email = email;
      vault[s.code].updatedAt = new Date().toISOString();
      fs.writeFileSync(VAULT.VAULT_FILE, JSON.stringify(vault, null, 2));
      conv.delete(chatId);
      return bot.sendMessage(chatId, `✅ Email untuk ${s.code} diupdate.`, backBtn('accounts:detail:' + s.code));
    } catch (e) { return bot.sendMessage(chatId, `❌ Gagal: ${e.message}`, cancelBtn()); }
  }
  if (s.step === 'wait_acct_edit_password') {
    const password = text.trim();
    try {
      const vault = JSON.parse(fs.readFileSync(VAULT.VAULT_FILE, 'utf8'));
      vault[s.code].password = password;
      vault[s.code].updatedAt = new Date().toISOString();
      fs.writeFileSync(VAULT.VAULT_FILE, JSON.stringify(vault, null, 2));
      conv.delete(chatId);
      return bot.sendMessage(chatId, `✅ Password untuk ${s.code} diupdate.`, backBtn('accounts:detail:' + s.code));
    } catch (e) { return bot.sendMessage(chatId, `❌ Gagal: ${e.message}`, cancelBtn()); }
  }
  if (s.step === 'wait_acct_edit_dealer') {
    const dealerName = text.trim();
    try {
      const vault = JSON.parse(fs.readFileSync(VAULT.VAULT_FILE, 'utf8'));
      vault[s.code].dealerName = dealerName;
      vault[s.code].updatedAt = new Date().toISOString();
      fs.writeFileSync(VAULT.VAULT_FILE, JSON.stringify(vault, null, 2));
      conv.delete(chatId);
      return bot.sendMessage(chatId, `✅ Dealer untuk ${s.code} diupdate.`, backBtn('accounts:detail:' + s.code));
    } catch (e) { return bot.sendMessage(chatId, `❌ Gagal: ${e.message}`, cancelBtn()); }
  }
});

// ====== SHOW PREVIEW ======
async function showPreview(chatId, s) {
  const { name, phone, motorType, nik, address, asalName, occupation } = s.data;
  let txt = `📋 *Preview Prospek ${s.level}*\n\n`;
  txt += `👤 ${name}\n📞 ${phone}\n📌 Asal: *${asalName}*\n`;
  if (occupation) txt += `💼 ${occupation}\n`;
  if (motorType) txt += `🏍 ${motorType}\n`;
  if (nik) txt += `🆔 NIK: ${nik}\n`;
  if (address) txt += `📍 ${address}\n`;
  txt += `\n🔑 Sales: ${jwtName()}\n🏢 ${jwtChannelName()}\n📊 *${s.level}*`;
  convSet(chatId, { ...s, step: 'preview' });
  await bot.sendMessage(chatId, txt, { parse_mode: 'Markdown', ...confirmBtn() });
}

// ====== EOM CRON ======
// End of month: all non-DEAL → LOST
async function runEomReset() {
  if (!jwt) { console.log('EOM: no JWT'); return; }
  try {
    console.log('EOM: fetching active prospects...');
    const result = await callStar(QRY_LIST, { first: 200, where: { prospectStatus: { in: ['LOW','MEDIUM','HOT','PROSPECT'] } } });
    const nodes = result?.getCustomerProspectFromCustomers?.nodes || [];
    console.log(`EOM: found ${nodes.length} active prospects`);
    let updated = 0;
    for (const p of nodes) {
      try {
        await updateStatus(p.id, 'LOST');
        updated++;
        console.log(`  -> ${p.prospectNumber} set to LOST`);
      } catch (e) {
        console.error(`  -> ${p.prospectNumber} FAILED: ${e.message}`);
      }
    }
    console.log(`EOM: ${updated}/${nodes.length} prospects set to LOST`);
  } catch (e) {
    console.error('EOM error:', e.message);
  }
}

// Jalankan EOM reset jika hari terakhir bulan
function checkEom() {
  const now = new Date();
  const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
  if (now.getMonth() !== tmr.getMonth()) {
    console.log('EOM: today is last day of month!');
    runEomReset();
  }
}

// ====== START ======
checkEom();
console.log('🤖 Prospek Bot ready — @Rd_prospek_bot');
