// saskia-bulk-notdeal.js — Bulk Not Deal prospect SASKIA (Juli 2026) → LOST
// JWT: SASKIA AL FURKHANA LAPRASTA (saskia.laprasta@hso.astra.co.id)
// UUID: c2e2ec68-14d9-4fee-912a-1609870afc3e
// Usage: node saskia-bulk-notdeal.js [reasonCode]
//   reasonCode default: TIDAK_BERMINAT
//   Valid codes: TIDAK_BERMINAT, HARGA_MAHAL, SUDAH_PUNYA, DOWN_PAYMENT_MAHAL,
//                JARAK_TEMPAT, RESPON_LAMBAT, TIDAK_RESPON, BANTUAN_PIMPINAN,
//                LAINNYA, SISA_STOK, MOTOR_SEDANG_SERVIS, TIDAK_LAYAK_KREDIT,
//                OVER_KREDIT, BANDING_HARGA

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const JWT_FILE = path.join(__dirname, 'jwt-saskia.txt');
const DATA_FILE = path.join(__dirname, 'saskia-active-prospects.json');

let jwt = '';
try { jwt = fs.readFileSync(JWT_FILE, 'utf8').trim(); } catch {}
if (!jwt) { console.error('ERROR: JWT not found at', JWT_FILE); process.exit(1); }

const STAR_API = 'https://api.star.astra.co.id/graphql/';
const ORIGIN = 'https://assist.star.astra.co.id';
const SASKIA_UUID = 'c2e2ec68-14d9-4fee-912a-1609870afc3e';

const REASONS = [
  'TIDAK_BERMINAT', 'HARGA_MAHAL', 'SUDAH_PUNYA', 'DOWN_PAYMENT_MAHAL',
  'JARAK_TEMPAT', 'RESPON_LAMBAT', 'TIDAK_RESPON', 'BANTUAN_PIMPINAN',
  'LAINNYA', 'SISA_STOK', 'MOTOR_SEDANG_SERVIS', 'TIDAK_LAYAK_KREDIT',
  'OVER_KREDIT', 'BANDING_HARGA',
];

const REASON = process.argv[2] || 'TIDAK_BERMINAT';
if (!REASONS.includes(REASON)) {
  console.error('ERROR: Unknown reasonCode. Valid:', REASONS.join(', '));
  process.exit(1);
}

const MUT_UPDATE = `mutation UpdateStatus($data: UpdateCustomerProspectStatusInputFromCustomers!) {
  ensureUpdateCustomerProspectStatusFromCustomers(input: $data) { id name prospectStatus }
}`;

// --- gql: fetch prospects using curl exec (same as test harness) ---
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function gqlFetch(query, vars) {
  const body = JSON.stringify({ query, variables: vars || {} });
  const escaped = body.replace(/'/g, "'\\''");
  const cmd = `curl -s --max-time 30 '${STAR_API}' \\
    -H 'Authorization: Bearer ${jwt}' \\
    -H 'Content-Type: application/json' \\
    -H 'origin: ${ORIGIN}' \\
    -H 'referer: ${ORIGIN}/' \\
    -H 'user-agent: Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36' \\
    -d '${escaped}'`;

  const stdout = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const json = JSON.parse(stdout.trim());
  if (json.errors) {
    throw new Error(json.errors.map(e => e.message).join(' | '));
  }
  return json.data;
}

async function gqlQuery(status, after = null) {
  const cursorArg = after ? `, after: "${after}"` : '';
  const query = `{
    getCustomerProspectFromCustomers(
      first: 10${cursorArg},
      where: {
        prospectNumber: { startsWith: "H704-PRS" },
        prospectStatus: { eq: ${status} },
        createdBy: { eq: "${SASKIA_UUID}" },
        created: { gte: "2026-07-01T00:00:00Z", lte: "2026-07-31T23:59:59Z" }
      }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes { id name prospectNumber prospectStatus mobilePhoneNumber createdBy }
    }
  }`;
  return gqlFetch(query);
}

// --- fetch all active prospects for Saskia (HOT + MEDIUM + LOW) ---
async function fetchAllSaskiaProspects() {
  const all = [];
  for (const status of ['HOT', 'MEDIUM', 'LOW']) {
    let after = null;
    let hasNext = true;
    while (hasNext) {
      const data = await gqlQuery(status, after);
      const conn = data.getCustomerProspectFromCustomers;
      for (const n of conn.nodes) {
        // Safety: double-check UUID matches
        if (n.createdBy === SASKIA_UUID) all.push(n);
      }
      hasNext = conn.pageInfo.hasNextPage;
      after = conn.pageInfo.endCursor;
      console.log(`  [${status}] +${conn.nodes.length} → total saskia: ${all.filter(p => p.prospectStatus === status).length}, hasNext=${hasNext}`);
      if (hasNext) await sleep(3000);
    }
  }

  // Deduplicate by id
  const seen = new Set();
  const unique = all.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return unique;
}

// --- mutation: update single prospect to LOST ---
async function updateToLost(prospectId, reason) {
  const data = await gqlFetch(MUT_UPDATE, {
    data: { customerProspectId: prospectId, prospectStatus: 'LOST', reasonNotDeal: reason }
  });
  return data.ensureUpdateCustomerProspectStatusFromCustomers;
}

// --- main ---
async function run() {
  console.log('===========================================');
  console.log('SASKIA BULK NOT DEAL — Juli 2026');
  console.log('===========================================');
  console.log('JWT      :', JWT_FILE);
  console.log('UUID     :', SASKIA_UUID);
  console.log('Reason   :', REASON);
  console.log('Statuses : HOT, MEDIUM, LOW');
  console.log('Period   : 2026-07-01 → 2026-07-31');
  console.log('');

  // Step 1: fetch prospects
  console.log('[STEP 1] Fetching Saskia prospects...');
  const prospects = await fetchAllSaskiaProspects();
  console.log(`\nTotal prospects found: ${prospects.length}`);
  const byStatus = {};
  for (const p of prospects) {
    if (!byStatus[p.prospectStatus]) byStatus[p.prospectStatus] = 0;
    byStatus[p.prospectStatus]++;
  }
  for (const [s, c] of Object.entries(byStatus)) {
    console.log(`  ${s}: ${c}`);
  }
  console.log('');

  if (prospects.length === 0) {
    console.log('No prospects found. Exiting.');
    return;
  }

  // Save to JSON
  fs.writeFileSync(DATA_FILE, JSON.stringify(prospects, null, 2));
  console.log(`Saved to ${DATA_FILE}`);
  console.log('');

  // Step 2: dry run — show all
  console.log('[STEP 2] Dry run — prospects that will be updated:');
  prospects.forEach((p, i) => {
    console.log(`  ${String(i+1).padStart(3)} [${p.prospectStatus}] ${p.name} (${p.prospectNumber})`);
  });
  console.log('');

  // Step 3: confirm
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = q => new Promise(res => rl.question(q, res));

  const ans = await question(
    `Update ${prospects.length} prospects to LOST with reason "${REASON}"? ` +
    `Type "YA" to proceed: `
  );
  rl.close();

  if (ans.trim().toUpperCase() !== 'YA') {
    console.log('Cancelled. No changes made.');
    return;
  }

  // Step 4: bulk update
  console.log('\n[STEP 3] Starting bulk update...');
  let ok = 0, fail = 0, skip = 0;
  for (let i = 0; i < prospects.length; i++) {
    const p = prospects[i];
    const n = i + 1;
    process.stdout.write(`  [${n}/${prospects.length}] ${p.name} → LOST (${REASON}) ... `);

    try {
      await updateToLost(p.id, REASON);
      console.log('OK');
      ok++;
    } catch (e) {
      if (e.message.includes('already')) {
        console.log('SKIP');
        skip++;
      } else {
        console.log('FAIL:', e.message.substring(0, 100));
        fail++;
      }
    }

    // Delay between mutations to avoid rate limit
    if (i < prospects.length - 1) await sleep(3000);
  }

  console.log('');
  console.log('===========================================');
  console.log('DONE');
  console.log('  OK     :', ok);
  console.log('  FAIL   :', fail);
  console.log('  SKIPPED:', skip);
  console.log('  TOTAL  :', prospects.length);
  console.log('===========================================');
}

run().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
