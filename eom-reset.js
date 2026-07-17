// eom-reset.js — End of Month: set all non-DEAL prospects to LOST
const fs = require('fs');
const path = require('path');

const JWT_FILE = path.join(__dirname, 'jwt.txt');
let jwt = '';
try { jwt = fs.readFileSync(JWT_FILE, 'utf8').trim(); } catch {}

if (!jwt) { console.log('EOM: NO JWT'); process.exit(1); }

const STAR_API = 'https://api.star.astra.co.id/graphql/';

const callStar = async (query, vars) => {
  const r = await fetch(STAR_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ query, variables: vars }),
  });
  const json = JSON.parse(await r.text());
  if (json.errors) throw new Error(json.errors.map(e => e.message).join(', '));
  return json.data;
};

const MUT_UPDATE = `mutation UpdateCustomerProspect($data: UpdateCustomerProspectStatusInputFromCustomers!) {
  ensureUpdateCustomerProspectStatusFromCustomers(input: $data) { id prospectStatus }
}`;

const QRY_ACTIVE = `query GetProspek($first: Int) {
  getCustomerProspectFromCustomers(first: $first, where: { prospectStatus: { in: ["LOW","MEDIUM","HOT","PROSPECT"] } }, order: [{ created: DESC }]) {
    nodes { id prospectNumber name prospectStatus }
  }
}`;

async function run() {
  console.log('EOM RESET: Fetching active prospects...');
  const result = await callStar(QRY_ACTIVE, { first: 500 });
  const nodes = result?.getCustomerProspectFromCustomers?.nodes || [];
  console.log(`EOM RESET: Found ${nodes.length} active prospects`);

  let ok = 0, fail = 0;
  for (const p of nodes) {
    try {
      await callStar(MUT_UPDATE, {
        data: { customerProspectId: p.id, prospectStatus: 'LOST', reasonNotDeal: 'EOM reset — belum deal', reason: 'EOM auto-reset' }
      });
      ok++;
    } catch (e) {
      console.error(`  FAIL: ${p.prospectNumber}: ${e.message}`);
      fail++;
    }
  }
  console.log(`EOM RESET Done: ${ok} updated, ${fail} failed`);
}

run().catch(e => { console.error('EOM FATAL:', e.message); process.exit(1); });
