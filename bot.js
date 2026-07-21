// prospek-bot/bot.js — Telegram bot untuk input prospek Star API
// Fitur: LOW (nama+hp), MEDIUM (+motor+alamat), HOT (+NIK), upgrade status
const { TelegramBot } = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { getOccupationHso } = require('./occupation-map');
const { getMotorList, validateMotorCode } = require('./motor-map');

// ====== CONFIG ======
const TG_TOKEN = process.env.TG_TOKEN || fs.readFileSync(path.join(__dirname, 'tg_token.txt'), 'utf8').trim();
const JWT_FILE = path.join(__dirname, 'jwt.txt');
const STATE_FILE = path.join(__dirname, 'state.json');

let jwt = '';
try { jwt = fs.readFileSync(JWT_FILE, 'utf8').trim(); } catch {}

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
    `-H 'Content-Type: application/json' ` +
    `-H 'origin: ${ORIGIN}' ` +
    `-H 'referer: ${ORIGIN}/' ` +
    `-H 'user-agent: Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36' ` +
    `-d '${escaped}'`;
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

// In-memory conversation state
const conv = new Map(); // chatId -> { step, level, data }

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
       { text: 'ℹ️ Status', callback_data: 'status' }],
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
  await bot.sendMessage(msg.chat.id,
    `✅ JWT tersimpan!\n👤 ${claims.name} (${claims.email})\n⏳ Exp: ${new Date(claims.exp*1000).toLocaleString('id-ID', {timeZone:'Asia/Makassar',hour12:false})} WITA`,
    mainMenu);
});

// /status
bot.onText(/^\/status/, async (msg) => {
  await bot.sendMessage(msg.chat.id, jwtInfo(), { parse_mode: 'Markdown' });
});

// ====== CALLBACK QUERIES ======
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const msgId = q.message.message_id;
  const data = q.data;
  const c = conv.get(chatId) || {};
  await bot.answerCallbackQuery(q.id);

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
    conv.set(chatId, { step: 'wait_jwt' });
    return;
  }

  // --- FF/EXCEL MENU ---
  if (data === 'ff:menu') {
    conv.set(chatId, { step: 'ff_input' });
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
    const s = conv.get(chatId);
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
    conv.set(chatId, { step: 'ask_name', level, data: {} });
    return editMsg(chatId, msgId,
      `📝 *Prospek ${level}*\nField: ${descs[level]}\n\nSilakan masukkan **nama lengkap customer**:`, cancelBtn());
  }

  // --- ASAL PROSPEK SELECTED ---
  if (data.startsWith('asal:')) {
    const s = conv.get(chatId);
    if (!s || s.step !== 'ask_asal') return;
    const asalKey = data.split(':')[1];
    const asal = ASAL_PROSPEK[asalKey];
    if (!asal) return;
    s.data.asalId = asal.id;
    s.data.asalName = asal.name;
    s.data.asalKey = asalKey;
    conv.set(chatId, s);
    
    // LOW: selesai, langsung preview
    if (s.level === 'LOW') {
      return showPreview(chatId, s);
    }
    // MEDIUM/HOT: pilih motor
    s.step = 'ask_motor';
    conv.set(chatId, s);
    return editMsg(chatId, msgId, `📌 Asal: *${asal.name}*\n\n🏍 *Pilih TIPE MOTOR*:`, motorKeyboard());
  }

  // --- MOTOR SELECTED (via keyboard) ---
  if (data.startsWith('motor:')) {
    const s = conv.get(chatId);
    if (!s || s.step !== 'ask_motor') return;
    const motorCode = data.split(':')[1];
    s.data.motorCode = motorCode;
    s.data.motorType = motorCode;
    conv.set(chatId, s);
    
    // Lanjut occupation
    s.step = 'ask_occupation';
    conv.set(chatId, s);
    return editMsg(chatId, msgId, `🏍 Motor: *${motorCode}*\n\n💼 Masukkan **pekerjaan** customer:\n(contoh: Pedagang, Petani, Wiraswasta, Ibu RT, Karyawan)`, cancelBtn());
  }

  // --- MOTOR LIST (show all available) ---
  if (data === 'motor:list') {
    const s = conv.get(chatId);
    if (!s || s.step !== 'ask_motor') return;
    const motors = getMotorList();
    let txt = `🏍 *Daftar Kode Motor:*\n\n`;
    for (const m of motors) {
      txt += `• *${m.code}* - ${m.name}\n`;
    }
    txt += `\nKetik kode motor (misal: LY2, Vario 125):`;
    conv.set(chatId, { ...s, step: 'ask_motor_text' });
    return editMsg(chatId, msgId, txt, cancelBtn());
  }

  // --- CONFIRM CREATE ---
  if (data === 'confirm') {
    const s = conv.get(chatId);
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
    conv.set(chatId, { step: 'upgrade_search' });
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
        conv.set(chatId, { step: 'upgrade_confirm', prospectId, newStatus: status, curStatus });
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
      const s = conv.get(chatId);
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
    conv.set(chatId, { step: 'search' });
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
    conv.set(chatId, { step: 'notdeal_status' });
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
    const s = conv.get(chatId) || {};
    s.notdeal_status = targetStatus;
    s.notdeal_reason = 'TIDAK_BERMINAT'; // hardcoded
    conv.set(chatId, s);

    const reason = 'TIDAK_BERMINAT';
    const statusLabel = targetStatus === 'ALL' ? 'HOT + MEDIUM + LOW' : targetStatus;

    // Count prospects per status
    const statuses = targetStatus === 'ALL' ? ['HOT', 'MEDIUM', 'LOW'] : [targetStatus];
    const counts = {};
    let totalCount = 0;
    let previewNodes = [];

    try {
      for (const st of statuses) {
        const q = '{ getCustomerProspectFromCustomers(first: 30, where: { prospectStatus: { eq: ' + st + ' } }) { nodes { id prospectNumber name prospectStatus } } }';
        const d = callStar(q);
        const nodes = d.getCustomerProspectFromCustomers.nodes;
        counts[st] = nodes.length;
        totalCount += nodes.length;
        if (previewNodes.length < 5) previewNodes.push(...nodes);
      }
    } catch (e) {
      return editMsg(chatId, msgId, `❌ Gagal fetch prospects: ${e.message}`, backBtn('notdeal:menu'));
    }

    if (totalCount === 0) {
      return editMsg(chatId, msgId,
        `❌ Tidak ada prospek *${statusLabel}* untuk di-update.`,
        backBtn('notdeal:menu'));
    }

    let preview = `🚫 *Preview Bulk Not Deal*\\n\\n`;
    preview += `Reason : *${reason}*\\n`;
    preview += `Status : *${statusLabel}*\\n`;
    preview += `Total  : *${totalCount}* prospects\\n\\n`;
    preview += `📋 Sample prospects:\\n`;
    for (const p of previewNodes.slice(0, 5)) {
      preview += `  • ${p.prospectNumber} | ${p.name} (${p.prospectStatus})\\n`;
    }
    preview += `\\n⚠️ SEMUA prospects di atas akan menjadi *LOST*.\\n`;
    preview += `Proses ini TIDAK bisa di-undo.\\n\\n`;
    preview += `Ketik *YA* untuk konfirmasi, atau batal.`;

    conv.set(chatId, { ...s, step: 'notdeal_confirm' });
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
    const s = conv.get(chatId) || {};
    if (!s.notdeal_reason) return editMsg(chatId, msgId, '❌ Session expired.', mainMenu);

    const reason = 'TIDAK_BERMINAT';
    const targetStatus = s.notdeal_status;
    const statuses = targetStatus === 'ALL' ? ['HOT', 'MEDIUM', 'LOW'] : [targetStatus];
    const statusLabel = targetStatus === 'ALL' ? 'HOT + MEDIUM + LOW' : targetStatus;

    await bot.answerCallbackQuery(q.id, { text: '⏳ Memproses...' });

    const MUT_ND = `mutation UpdateNotDeal($id: ID!, $reason: String!) { ensureUpdateCustomerProspectStatusFromCustomers(input: {customerProspectId: $id, prospectStatus: LOST, reasonNotDeal: $reason}) { id prospectStatus } }`;

    let totalOk = 0, totalFail = 0, totalSkipped = 0;
    const failedList = [];

    for (const st of statuses) {
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        try {
          const q = '{ getCustomerProspectFromCustomers(first: 25, where: { prospectStatus: { eq: ' + st + ' } }) { nodes { id prospectNumber name prospectStatus } } }';
          const d = callStar(q);
          const nodes = d.getCustomerProspectFromCustomers.nodes;

          if (nodes.length === 0) { hasMore = false; break; }

          for (const p of nodes) {
            if (p.prospectStatus === 'LOST' || p.prospectStatus === 'DEAL') {
              totalSkipped++; continue;
            }
            try {
              callStar(MUT_ND, { id: p.id, reason });
              totalOk++;
            } catch (e) {
              totalFail++;
              if (failedList.length < 5) failedList.push(`${p.name}: ${e.message}`);
            }
            // Small delay to avoid rate limit
            await new Promise(r => setTimeout(r, 150));
          }

          if (nodes.length < 25) { hasMore = false; break; }
          page++;
        } catch (e) {
          return editMsg(chatId, msgId, `❌ Error fetch ${st}: ${e.message}`, mainMenu);
        }
      }
    }

    conv.delete(chatId);

    let resultTxt = `🚫 *Bulk Not Deal Selesai*\\n\\n`;
    resultTxt += `Reason : *${reason}*\\n`;
    resultTxt += `Status : *${statusLabel}*\\n\\n`;
    resultTxt += `✅ OK      : ${totalOk}\\n`;
    resultTxt += `⏭️ Skip    : ${totalSkipped}\\n`;
    resultTxt += `❌ Gagal   : ${totalFail}\\n`;
    if (failedList.length > 0) {
      resultTxt += `\\n⚠️ Gagal detail:\\n`;
      for (const f of failedList) resultTxt += `  • ${f}\\n`;
    }
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
    
    conv.set(chatId, { step: 'ff_confirm', ff_data: results, ff_errors: errors, ff_level: detectedLevel });
    
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
  const s = conv.get(chatId);
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
    conv.set(chatId, { step: 'ff_confirm', ff_data: results, ff_errors: errors, ff_level: detectedLevel });
    
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
    
    conv.set(chatId, { step: 'ff_confirm', ff_data: results, ff_errors: errors, ff_level: detectedLevel });
    
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
    conv.set(chatId, s);
    return promptMsg(chatId, `👤 Nama: *${text}*\n\n📞 Masukkan **nomor HP** (628xxx):`, cancelBtn());
  }

  // --- CREATE FLOW: phone ---
  if (s.step === 'ask_phone') {
    let phone = text.replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '62' + phone.slice(1);
    if (phone.length < 10) return bot.sendMessage(chatId, '❌ Nomor tidak valid. Minimal 10 digit (628xxx).');
    s.data.phone = phone;
    s.step = 'ask_asal';
    conv.set(chatId, s);
    return bot.sendMessage(chatId, `📞 HP: ${phone}\n\n📌 *Pilih ASAL PROSPEK*:`, asalKeyboard());
  }

  // --- CREATE FLOW: occupation (MEDIUM/HOT) ---
  if (s.step === 'ask_occupation') {
    if (text.length < 2) return bot.sendMessage(chatId, '❌ Pekerjaan terlalu pendek.');
    s.data.occupation = text;
    
    if (s.level === 'MEDIUM') {
      s.step = 'ask_address';
      conv.set(chatId, s);
      return promptMsg(chatId, `💼 Pekerjaan: *${text}*\n\n📍 Masukkan **alamat** (nama jalan, no rumah):`, cancelBtn());
    }
    // HOT: lanjut NIK dulu
    s.step = 'ask_nik';
    conv.set(chatId, s);
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
    conv.set(chatId, s);
    return promptMsg(chatId, `🏍 Motor: *${motor.name}*\n\n💼 Masukkan **pekerjaan** customer:\n(contoh: Pedagang, Petani, Wiraswasta, Ibu RT, Karyawan)`, cancelBtn());
  }

  // --- CREATE FLOW: NIK (HOT) ---
  if (s.step === 'ask_nik') {
    const nik = text.replace(/[^0-9]/g, '');
    if (nik.length < 16) return bot.sendMessage(chatId, '❌ NIK harus 16 digit.');
    s.data.nik = nik;
    s.step = 'ask_address';
    conv.set(chatId, s);
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
      conv.set(chatId, { step: 'upgrade_select' });
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
      conv.set(chatId, { step: 'search_result' });
      return bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: buttons } });
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Error: ${e.message}`, cancelBtn());
    }
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
  conv.set(chatId, { ...s, step: 'preview' });
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
