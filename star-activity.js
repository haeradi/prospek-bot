// star-activity.js — Fetch activities + staff clock-in/out from Star API
// Uses H704 JWT (ABDUL RAHMADAN) — reads from h704-bot cache automatically
//
// API endpoints discovered from h704-bot:
//   getAttendanceValidationFromActivity         → list all activities (POS/BTL)
//   getListStaffDetailActivityFromActivity      → staff clock-in/out per activity

const { readFileSync, existsSync } = require('fs');
const { execSync } = require('child_process');

const STAR_API = 'https://api.star.astra.co.id/graphql/';

// ── JWT source priority ───────────────────────────────────────────────────────
// Priority: prospek-bot jwt.txt (active account, follows /use switch) FIRST,
// then h704-bot cache as fallback. This makes activity queries adapt per-account.
function getJwtSync() {
  // Try prospek-bot jwt.txt first (active account — follows /use switch)
  const localJwt = '/home/ubuntu/prospek-bot/jwt.txt';
  if (existsSync(localJwt)) {
    try {
      const raw = readFileSync(localJwt, 'utf8').trim();
      if (raw.startsWith('eyJ')) {
        const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8'));
        if (payload.exp > Math.floor(Date.now() / 1000)) return raw;
      }
    } catch {}
  }

  // Fallback: h704-bot cache (updated by assist-bot)
  const h704Cache = '/home/ubuntu/h704-bot/jwt-h704-cache.txt';
  if (existsSync(h704Cache)) {
    try {
      const cached = JSON.parse(readFileSync(h704Cache, 'utf8'));
      if (cached.token) {
        const payload = JSON.parse(Buffer.from(cached.token.split('.')[1], 'base64').toString('utf8'));
        if (payload.exp > Math.floor(Date.now() / 1000)) {
          return cached.token;
        }
      }
    } catch {}
  }

  return null;
}

// ── GraphQL via curl ────────────────────────────────────────────────────────
function gql(query, variables = {}) {
  const jwt = getJwtSync();
  if (!jwt) throw new Error('No valid JWT found');

  const body = JSON.stringify({ query, variables });
  // Escape single quotes for shell
  const escaped = body.replace(/'/g, "'\\''");
  const cmd = `curl -s --max-time 15 '${STAR_API}' ` +
    `-H 'Authorization: Bearer ${jwt}' ` +
    `-H 'Content-Type: application/json' ` +
    `-d '${escaped}'`;

  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const d = JSON.parse(out);
  if (d.errors) throw new Error(d.errors[0].message);
  return d.data;
}

// ── ISO 8601 Duration → structured time ─────────────────────────────────────
// PT8H42M9.0931612S  →  { time: "08:42:09", label: "08:42 WITA" }
// The duration IS WITA time (phone local clock-in time, stored as hours from midnight)
function parseClockInDuration(isoDur) {
  if (!isoDur || isoDur === 'null' || isoDur === 'undefined') return null;
  if (typeof isoDur !== 'string') return null;

  if (isoDur.startsWith('P')) {
    const m = isoDur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
    if (!m) return { raw: isoDur, time: isoDur, label: isoDur };
    const h = parseInt(m[1] || '0', 10);
    const min = parseInt(m[2] || '0', 10);
    const sec = m[3] ? String(Math.round(parseFloat(m[3]))).padStart(2, '0') : '00';
    return {
      raw: isoDur,
      time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:${sec}`,
      label: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')} WITA`,
    };
  }

  // ISO datetime string fallback
  try {
    const d = new Date(isoDur);
    return {
      raw: isoDur,
      time: d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Makassar' }),
      label: d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' }) + ' WITA',
    };
  } catch {
    return { raw: isoDur, time: isoDur, label: isoDur };
  }
}

// ── Get all activities ──────────────────────────────────────────────────────
function getAllActivities() {
  const data = gql(`query {
    getAttendanceValidationFromActivity {
      assignmentActivityId activityIdForNotif activityType activityName
    }
  }`);
  return data.getAttendanceValidationFromActivity || [];
}

// ── Get staff for one activity (by activityIdForNotif) ──────────────────────
function getStaffForActivity(activityIdForNotif) {
  const data = gql(
    `query Q($aid: UUID!) {
      getListStaffDetailActivityFromActivity(activityId: $aid) {
        staffId name lastClockIn lastClockOut
      }
    }`,
    { aid: activityIdForNotif }
  );
  const staff = data.getListStaffDetailActivityFromActivity || [];
  return staff.map(s => ({
    staffId: s.staffId,
    name: s.name,
    lastClockIn: parseClockInDuration(s.lastClockIn),
    lastClockOut: parseClockInDuration(s.lastClockOut),
  }));
}

// ── Build full report: activities + staff ───────────────────────────────────
async function getFullActivityReport() {
  const activities = getAllActivities();
  return activities.map(a => ({
    ...a,
    staff: getStaffForActivity(a.activityIdForNotif),
  }));
}

// ── Format report for Telegram ───────────────────────────────────────────────
function formatActivityReport(report) {
  const lines = [];
  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Asia/Makassar'
  });

  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('  📋 AKTIVITAS HARI INI');
  lines.push(`  📅 ${today} WITA`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');

  for (const act of report) {
    lines.push('');
    lines.push(`【${act.activityType}】 ${act.activityName}`);
    lines.push(`  Staff: ${act.staff.length} org`);

    if (act.staff.length === 0) {
      lines.push('  └── (kosong)');
    } else {
      for (const s of act.staff) {
        const inTime = s.lastClockIn ? s.lastClockIn.label : '⏳ Belum Clock-in';
        const outTime = s.lastClockOut ? s.lastClockOut.label : '–';
        const badge = s.lastClockOut ? '🟢' : (s.lastClockIn ? '🟡' : '⚪');
        lines.push(`  ${badge} ${s.name}`);
        lines.push(`     In: ${inTime}  |  Out: ${outTime}`);
      }
    }
  }

  const allStaff = report.flatMap(a => a.staff);
  const clockedIn = allStaff.filter(s => s.lastClockIn && !s.lastClockOut).length;
  const clockedOut = allStaff.filter(s => s.lastClockOut).length;
  const notYet = allStaff.filter(s => !s.lastClockIn).length;

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`  Total: ${allStaff.length} | 🟡 ${clockedIn} in | 🟢 ${clockedOut} out | ⚪ ${notYet} belum`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

// ── POS only status ─────────────────────────────────────────────────────────
function formatPOSReport(report) {
  const pos = report.filter(a => a.activityType === 'POS');
  const lines = [];
  const today = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar'
  });

  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('  🏪 POS — Clock-in Status');
  lines.push(`  📅 ${today} WITA`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');

  for (const act of pos) {
    lines.push('');
    for (const s of act.staff) {
      const inTime = s.lastClockIn ? s.lastClockIn.label : '⏳ Belum Clock-in';
      const outTime = s.lastClockOut ? s.lastClockOut.label : '–';
      const badge = s.lastClockOut ? '🟢' : (s.lastClockIn ? '🟡' : '⚪');
      lines.push(`${badge} ${s.name}`);
      lines.push(`   🕐 ${inTime}${s.lastClockOut ? ' → ' + outTime : ''}`);
    }
  }

  const allPOS = pos.flatMap(a => a.staff);
  const clockedIn = allPOS.filter(s => s.lastClockIn && !s.lastClockOut).length;
  lines.push('');
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`  ✅ Clock-in: ${clockedIn}/${allPOS.length}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

// ── BTL only status ─────────────────────────────────────────────────────────
function formatBTLReport(report) {
  const btl = report.filter(a => a.activityType === 'BTL');
  const lines = [];
  const today = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar'
  });

  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('  📣 BTL — Clock-in Status');
  lines.push(`  📅 ${today} WITA`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');

  for (const act of btl) {
    lines.push('');
    for (const s of act.staff) {
      const inTime = s.lastClockIn ? s.lastClockIn.label : '⏳ Belum Clock-in';
      const outTime = s.lastClockOut ? s.lastClockOut.label : '–';
      const badge = s.lastClockOut ? '🟢' : (s.lastClockIn ? '🟡' : '⚪');
      lines.push(`${badge} ${s.name}`);
      lines.push(`   🕐 ${inTime}${s.lastClockOut ? ' → ' + outTime : ''}`);
    }
  }

  const allBTL = btl.flatMap(a => a.staff);
  const clockedIn = allBTL.filter(s => s.lastClockIn && !s.lastClockOut).length;
  lines.push('');
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`  ✅ Clock-in: ${clockedIn}/${allBTL.length}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

// ── Verify JWT ──────────────────────────────────────────────────────────────
function verifyJwt() {
  const jwt = getJwtSync();
  if (!jwt) return { ok: false, error: 'No JWT found' };
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    const valid = payload.exp > now;
    return {
      ok: valid,
      name: payload.name,
      exp: new Date(payload.exp * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Makassar' }),
      remaining: valid ? Math.round((payload.exp - now) / 3600 * 10) / 10 + 'h' : 'EXPIRED',
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────
module.exports = {
  getAllActivities,
  getStaffForActivity,
  getFullActivityReport,
  formatActivityReport,
  formatPOSReport,
  formatBTLReport,
  verifyJwt,
  getJwtSync,
};
