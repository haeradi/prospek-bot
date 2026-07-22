// login-star.js — Playwright OIDC login untuk Star API, simpan JWT ke vault
// Usage: node login-star.js <ACCOUNT_CODE>
// Bot mode:  node login-star.js SASKIA --chat-id <telegram_chat_id>
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `login-star-${Date.now()}.log`);
const VAULT = require('./vault-manager');
const STAR_API = 'https://api.star.astra.co.id/graphql/';
const MFA_WAIT_SECONDS = 240;

// ─── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let accountCode = null;
let chatId = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chat-id' && args[i+1]) {
    chatId = args[i+1];
    i++;
  } else if (!args[i].startsWith('--')) {
    accountCode = args[i].toUpperCase();
  }
}
if (!accountCode) {
  console.error('Usage: node login-star.js <ACCOUNT_CODE> [--chat-id <telegram_chat_id>]');
  process.exit(1);
}

// ─── Status file (IPC between login process and bot) ──────────────────────────
// Bot polls this file and forwards updates to Telegram
const STATUS_FILE = path.join(LOG_DIR, `login-status-${accountCode}.json`);

function updateStatus(step, message, extra = {}) {
  const data = {
    code: accountCode,
    step,       // 'login' | 'mfa' | 'done' | 'error'
    message,
    ts: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
  // Also log
  const line = `[${new Date().toISOString()}] [${step}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  // Also send Telegram if we have chatId
  sendTelegram(message);
}

// ─── Telegram notify ─────────────────────────────────────────────────────────
function sendTelegram(text) {
  if (!chatId) return;
  try {
    const TG_TOKEN = fs.readFileSync(path.join(ROOT, 'tg_token.txt'), 'utf8').trim();
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const cmd = `curl -s --max-time 10 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" ` +
      `-H "Content-Type: application/json" ` +
      `-d "{\\"chat_id\\":${chatId},\\"text\\":\\"${escaped}\\"}"`;
    execSync(cmd, { encoding: 'utf8' });
  } catch (e) {
    console.log('[TG] failed:', e.message);
  }
}

// ─── JWT decode ─────────────────────────────────────────────────────────────
function decodeJwtPayload(jwt) {
  try {
    const [, payload] = jwt.split('.');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch { return null; }
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function runLogin() {
  const account = VAULT.getAccount(accountCode);
  if (!account) throw new Error(`Akun ${accountCode} tidak ditemukan di vault.`);
  if (!account.password) throw new Error(`Password untuk ${accountCode} belum di-set.`);

  updateStatus('login', `🔐 *Login Star [${accountCode}]*\nMulai login...\nAccount: ${account.email}\nDealer: ${account.dealerName}`);

  const { chromium } = require('./node_modules/playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });

  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await ctx.newPage();

  // Shared state between response handler and main loop
  const tokenState = { starApiSeen: false, saved: false };
  const tokenPath = path.join(LOG_DIR, `token-${accountCode}.json`);

  // Capture Star API requests
  page.on('response', resp => {
    if (resp.url().includes('api.star.astra.co.id')) {
      tokenState.starApiSeen = true;
      updateStatus('login', `🔐 [${accountCode}] Star API request detected — MFA approved!`);
    }
  });

  // ── Step 1: ASSIST login page ────────────────────────────────────────────
  updateStatus('login', `⏳ Buka halaman login ASSIST...`);
  await page.goto('https://assist.star.astra.co.id/login', { waitUntil: 'networkidle', timeout: 60000 });

  // ── Step 2: Fill email in ASSIST form ───────────────────────────────────
  updateStatus('login', `⏳ Input email...`);
  await page.waitForSelector('input[placeholder*="Username"]', { timeout: 20000 });
  await page.fill('input[placeholder*="Username"]', account.email);
  await page.click('button:has-text("Login")');
  await page.waitForTimeout(2000);

  // ── Step 3: Pick account on Microsoft (if shown) ─────────────────────────
  updateStatus('login', `⏳ Pilih akun di Microsoft...`);
  const pickSelectors = [
    `button[aria-label*="${account.email}"]`,
    `div[data-test-id="${account.email}"]`,
  ];
  for (const sel of pickSelectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 1500 })) {
        await loc.click();
        await page.waitForTimeout(2000);
        break;
      }
    } catch {}
  }

  // ── Step 4: Fill password ────────────────────────────────────────────────
  updateStatus('login', `⏳ Input password...`);
  await page.waitForSelector('input[type="password"]', { timeout: 30000 });
  await page.fill('input[type="password"]', account.password);
  await page.locator('input[type="submit"], button:has-text("Sign in")').first().click();

  // ── Step 5: Wait for MFA ────────────────────────────────────────────────
  await page.waitForTimeout(3000);

  let mfaNumber = null;
  const mfaFindDeadline = Date.now() + 30000;
  while (Date.now() < mfaFindDeadline) {
    const txt = await page.locator('body').innerText().catch(() => '');
    // Try #idRichContext_DisplaySign (the number element)
    const signEl = page.locator('#idRichContext_DisplaySign');
    if (await signEl.count() > 0) {
      const num = (await signEl.textContent().catch(() => '')).trim();
      if (/^\d{2,3}$/.test(num)) {
        mfaNumber = num;
        break;
      }
    }
    // Fallback: regex on body text
    const m = txt.match(/enter the number[\s\S]{0,200}?(\d{2,3})/i);
    if (m) { mfaNumber = m[1]; break; }
    if (/Stay signed in|Tetap masuk/i.test(txt)) break;
    await page.waitForTimeout(500);
  }

  if (mfaNumber) {
    updateStatus('mfa',
      `🔐 *Login [${accountCode}] — VERIFIKASI*\n\n` +
      `Buka *Microsoft Authenticator*\n` +
      `Tap angka: *${mfaNumber}*\n\n` +
      `⏳ Menunggu approve...`
    );
  } else {
    updateStatus('mfa',
      `🔐 *Login [${accountCode}]*\n\n` +
      `MFA push sudah dikirim.\n` +
      `Buka Authenticator app, approve request.\n\n` +
      `⏳ Menunggu approve...`
    );
  }

  // ── Step 6: Wait for MFA approval + handle KMSI + redirect to ASSIST ─────
  // PROVEN FLOW (from assist-bot/login.js):
  //   1. Poll for redirect to assist.star.astra.co.id
  //   2. Handle "Stay signed in?" (KMSI) prompt → click Yes
  //   3. Once on ASSIST: networkidle + poll localStorage for oidc.user token
  //   DO NOT navigate to identity domain — that wipes the session token!
  const deadline = Date.now() + MFA_WAIT_SECONDS * 1000;
  let onAssist = false;
  let kmsiHandled = false;

  while (Date.now() < deadline) {
    try { if (page.isClosed()) break; } catch { break; }
    const url = page.url() || '';

    // Redirected to ASSIST = MFA approved successfully
    if (/assist\.star\.astra\.co\.id/.test(url)) {
      onAssist = true;
      break;
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');

    // Handle KMSI "Stay signed in?" prompt
    if (!kmsiHandled && /Stay signed in|Tetap masuk/i.test(bodyText)) {
      updateStatus('login', `⏳ [${accountCode}] Klik "Stay signed in"...`);
      const ok = await page.locator('input[type="submit"][value="Yes"], button:has-text("Yes")')
        .first().click({ timeout: 5000 }).then(() => true).catch(() => false);
      if (!ok) {
        await page.locator('#idSIButton9').click({ timeout: 5000 }).catch(() => {});
      }
      kmsiHandled = true;
      await page.waitForTimeout(2000);
    }

    // MFA denied
    if (/We didn't hear from your phone|It looks like you didn't approve|denied/i.test(bodyText)) {
      updateStatus('error', `❌ *Login [${accountCode}]*\nMFA ditolak atau timeout di HP.\n\nCoba /relogin ${accountCode} lagi.`);
      await browser.close();
      return;
    }

    await page.waitForTimeout(1500);
  }

  if (!onAssist) {
    updateStatus('error', `❌ *Login GAGAL [${accountCode}]*\n\nTimeout (${MFA_WAIT_SECONDS}s) — tidak redirect ke ASSIST.\nMFA mungkin belum di-approve.\n\nCoba /relogin ${accountCode} lagi.`);
    await browser.close();
    return;
  }

  // ── Step 7: On ASSIST — poll localStorage for token (assist-bot method) ───
  updateStatus('login', `✅ [${accountCode}] Login sukses — mengambil JWT...`);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  let access_token = null, refresh_token = null, id_token = null;
  const tokenDeadline = Date.now() + 20000;

  while (Date.now() < tokenDeadline && !access_token) {
    const storage = await page.evaluate(() => {
      const dump = (s) => {
        const out = {};
        try { for (let i = 0; i < s.length; i++) { const k = s.key(i); out[k] = s.getItem(k); } } catch {}
        return out;
      };
      return { local: dump(localStorage), session: dump(sessionStorage) };
    });

    // Method 1: oidc.user blob with access_token
    for (const [k, v] of Object.entries(storage.local || {})) {
      if (/oidc\.user/i.test(k) && typeof v === 'string') {
        try {
          const parsed = JSON.parse(v);
          if (parsed.access_token) {
            access_token = parsed.access_token;
            refresh_token = parsed.refresh_token || null;
            id_token = parsed.id_token || null;
            break;
          }
        } catch {}
      }
    }
    if (access_token) break;

    // Method 2: any localStorage value containing a star_api JWT
    for (const [k, v] of Object.entries(storage.local || {})) {
      if (typeof v === 'string' && /eyJ[A-Za-z0-9_-]{20,}\.eyJ/.test(v)) {
        const m = v.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
        if (m) {
          const p = decodeJwtPayload(m[0]);
          if (p && JSON.stringify(p.aud || '').includes('star_api')) {
            access_token = m[0];
            break;
          }
        }
      }
    }
    if (access_token) break;

    // Method 3: sessionStorage
    for (const [k, v] of Object.entries(storage.session || {})) {
      if (typeof v === 'string' && /eyJ[A-Za-z0-9_-]{20,}\.eyJ/.test(v)) {
        const m = v.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
        if (m) {
          const p = decodeJwtPayload(m[0]);
          if (p && JSON.stringify(p.aud || '').includes('star_api')) {
            access_token = m[0];
            break;
          }
        }
      }
    }
    if (access_token) break;

    await page.waitForTimeout(2000);
  }

  // Save auth-state for reference
  try {
    await ctx.storageState({ path: path.join(LOG_DIR, `auth-state-${accountCode}.json`) });
  } catch {}

  await browser.close();

  if (!access_token) {
    updateStatus('error', `❌ *Login [${accountCode}]*\nLogin sukses tapi JWT tidak ter-capture di localStorage.\n\nCoba /relogin ${accountCode} lagi.`);
    return;
  }

  // Save token file
  const p = decodeJwtPayload(access_token);
  fs.writeFileSync(tokenPath, JSON.stringify({
    access_token, refresh_token, id_token,
    savedAt: new Date().toISOString(),
    name: p?.name, sub: p?.sub, exp: p?.exp,
  }, null, 2));

  const expStr = p?.exp ? new Date(p.exp * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Makassar', dateStyle: 'medium', timeStyle: 'short' }) : '?';
  updateStatus('login', `✅ [${accountCode}] JWT captured: ${p?.name}\nExp: ${expStr}`);

  // ── Step 8: Verify token & save to vault ──────────────────────────────────
  await verifyAndSaveToken(tokenPath);
}


async function extractTokenFromIdentity(page) {
  // Navigate to identity domain to read its localStorage
  try {
    await page.goto('https://identity.star.astra.co.id/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    updateStatus('login', `⚠️ Navigation to identity failed: ${e.message}`);
  }

  const storage = await page.evaluate(() => {
    try {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
      }
      return out;
    } catch { return {}; }
  });

  for (const [k, v] of Object.entries(storage)) {
    if (/oidc\.user.*star_api/i.test(k) && typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        if (parsed.access_token) {
          const p = decodeJwtPayload(parsed.access_token);
          if (p && p.exp && p.exp > Math.floor(Date.now() / 1000)) {
            const data = {
              access_token: parsed.access_token,
              refresh_token: parsed.refresh_token || null,
              id_token: parsed.id_token || null,
              savedAt: new Date().toISOString(),
              name: p.name,
              sub: p.sub,
              exp: p.exp,
            };
            fs.writeFileSync(tokenPath, JSON.stringify(data, null, 2));

            const expStr = new Date(p.exp * 1000).toLocaleString('id-ID', {
              timeZone: 'Asia/Makassar', dateStyle: 'medium', timeStyle: 'short'
            });
            updateStatus('done',
              `✅ *Login BERHASIL [${accountCode}]*\n\n` +
              `Nama: ${p.name}\n` +
              `Exp : ${expStr}\n` +
              `Source: identity.star.astra.co.id`
            );
            return;
          }
        }
      } catch (e) {
        updateStatus('login', `⚠️ Parse oidc token error: ${e.message}`);
      }
    }
  }

  // Fallback: read from storageState file
  const ssPath = path.join(LOG_DIR, `auth-state-${accountCode}.json`);
  if (fs.existsSync(ssPath)) {
    try {
      const ssData = JSON.parse(fs.readFileSync(ssPath, 'utf8'));
      for (const origin of (ssData.origins || [])) {
        for (const [k, v] of Object.entries(origin.localStorage || {})) {
          if (/oidc.*star_api|star.*access/i.test(k) && typeof v === 'string' && v.length > 50) {
            try {
              const parsed = JSON.parse(v);
              if (parsed.access_token) {
                const p = decodeJwtPayload(parsed.access_token);
                if (p && p.exp > Math.floor(Date.now() / 1000)) {
                  const data = { access_token: parsed.access_token, refresh_token: parsed.refresh_token || null, id_token: parsed.id_token || null, savedAt: new Date().toISOString(), name: p.name, sub: p.sub, exp: p.exp };
                  fs.writeFileSync(tokenPath, JSON.stringify(data, null, 2));
                  const expStr = new Date(p.exp * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Makassar', dateStyle: 'medium', timeStyle: 'short' });
                  updateStatus('done', `✅ *Login BERHASIL [${accountCode}]*\n\nNama: ${p.name}\nExp : ${expStr}\nSource: storageState fallback`);
                  return;
                }
              }
            } catch {}
          }
        }
      }
    } catch (e) {}
  }

  updateStatus('error', `⚠️ *Login [${accountCode}]*\nToken tidak ditemukan di localStorage.\n\nSudah di-redirect ke ASSIST tapi JWT tidak ter-capture.\n\nCoba /relogin ${accountCode} lagi.`);
}

async function verifyAndSaveToken(tokenPath) {
  if (!fs.existsSync(tokenPath)) {
    updateStatus('error', `❌ Token file not found: ${tokenPath}`);
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    if (!data.access_token) throw new Error('No access_token in token file');

    // Verify it works
    const { execSync: ex } = require('child_process');
    const testBody = JSON.stringify({ query: '{ __typename }' });
    const escaped = testBody.replace(/'/g, "'\\''");
    const cmd = `curl -s --max-time 10 '${STAR_API}' ` +
      `-H 'Authorization: Bearer ${data.access_token}' ` +
      `-H 'Content-Type: application/json' ` +
      `-d '${escaped}'`;
    const out = ex(cmd, { encoding: 'utf8' });
    const resp = JSON.parse(out);
    if (resp.errors) {
      updateStatus('error', `❌ Token invalid — API error: ${resp.errors[0].message}`);
      return;
    }

    // Save to vault
    const expDate = new Date(data.exp * 1000).toLocaleString('id-ID', {
      timeZone: 'Asia/Makassar', dateStyle: 'medium', timeStyle: 'short'
    });
    VAULT.saveJwt(accountCode, data.access_token);
    updateStatus('done',
      `✅ *Login & Verifikasi BERHASIL*\n\n` +
      `Token tersimpan di vault.\n` +
      `Nama : ${data.name}\n` +
      `Exp  : ${expDate}\n\n` +
      `Sesi login sudah selesai!`
    );
  } catch (e) {
    updateStatus('error', `❌ Verifikasi gagal: ${e.message}`);
  }
}

// ─── Run ────────────────────────────────────────────────────────────────────
updateStatus('login', `🚀 Starting login for ${accountCode}...`);
runLogin().then(() => {
  updateStatus('done', `Login process finished for ${accountCode}.`);
  process.exit(0);
}).catch(err => {
  updateStatus('error', `❌ *Login ERROR [${accountCode}]*\n\n${err.message}`);
  process.exit(1);
});
