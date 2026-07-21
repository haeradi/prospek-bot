// login-star.js — Playwright OIDC login untuk Star API, simpan JWT ke vault
// Usage: node login-star.js <ACCOUNT_CODE>
//   e.g.:  node login-star.js SASKIA
// Bot mode:  node login-star.js SASKIA --chat-id <telegram_chat_id>
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const LOG_DIR = '/home/ubuntu/prospek-bot/logs';
fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `login-star-${Date.now()}.log`);
const log = (...a) => {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${a.join(' ')}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
};

const VAULT    = require('./vault-manager');
const STAR_API = 'https://api.star.astra.co.id/graphql/';
const ASSIST_URL = 'https://assist.star.astra.co.id/assistant/customer-prospect';
const MFA_WAIT_SECONDS = 180;

// ─── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let accountCode = null;
let chatId = null; // Telegram chat ID to notify

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

// ─── Notify via Telegram ──────────────────────────────────────────────────────
function sendTelegram(text) {
  try {
    const TG_TOKEN = fs.readFileSync(path.join(ROOT, 'tg_token.txt'), 'utf8').trim();
    if (!chatId) return;
    const escaped = text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const cmd = `curl -s --max-time 10 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" ` +
      `-H "Content-Type: application/json" ` +
      `-d "{\\"chat_id\\":${chatId},\\"text\\":\\"${escaped}\\",\\"parse_mode\\":\\"Markdown\\"}"`;
    execSync(cmd, { encoding: 'utf8' });
  } catch (e) {
    log('[TG] notify failed:', e.message);
  }
}

function decodeJwtPayload(jwt) {
  try {
    const [, payload] = jwt.split('.');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch { return null; }
}

// ─── Main login flow ─────────────────────────────────────────────────────────
async function runLogin() {
  const account = VAULT.getAccount(accountCode);
  if (!account) throw new Error(`Account ${accountCode} not found in vault. Add via bot menu.`);
  if (!account.password) throw new Error(`No password for ${accountCode}. Update via bot menu.`);

  log(`=== Login flow for [${accountCode}] ${account.email} ===`);
  sendTelegram(`🔐 *Login Star [${accountCode}]*\nSedang proses login, tunggu sebentar...`);

  const { chromium } = require('/home/ubuntu/assist-bot/node_modules/playwright');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await ctx.newPage();

  const captured = { tokens: [], apiCalls: [] };

  // Capture network responses for JWT
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('api.star.astra.co.id') || url.includes('identity.star.astra.co.id') ||
        url.includes('/auth') || url.includes('/token')) {
      try {
        const body = await resp.text();
        captured.apiCalls.push({ url, status: resp.status(), body: body.slice(0, 4000) });
        const m = body.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
        if (m) captured.tokens.push({ url, token: m[0] });
      } catch {}
    }
  });

  try {
    // ── Step 1: Navigate to ASSIST login ────────────────────────────────────
    const loginUrl = 'https://assist.star.astra.co.id/login';
    log('Goto', loginUrl);
    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 60000 });

    // ── Step 2: Fill email ───────────────────────────────────────────────────
    log('Waiting for email field...');
    const assistFieldSel = 'input[placeholder*="Username"]';
    const msFieldSel = 'input[name="loginfmt"]';
    let emailFilled = false;
    const fieldDeadline = Date.now() + 40000;

    while (Date.now() < fieldDeadline && !emailFilled) {
      const assistEl = await page.$(assistFieldSel);
      if (assistEl) {
        try {
          await assistEl.scrollIntoViewIfNeeded().catch(() => {});
          await assistEl.click({ timeout: 3000 });
          await assistEl.fill(account.email);
          log('ASSIST Username filled');
          await page.click('button:has-text("Login")');
          emailFilled = true;
          break;
        } catch {}
      }
      const msEl = await page.$(msFieldSel);
      if (msEl) {
        try {
          await msEl.click({ timeout: 3000 });
          await msEl.fill(account.email);
          log('MS email filled');
          await page.click('input[type="submit"]');
          emailFilled = true;
          break;
        } catch {}
      }
      const pwdEl = await page.$('input[type="password"]');
      if (pwdEl) {
        log('Already on password page (cached session)');
        emailFilled = true;
        break;
      }
      await page.waitForTimeout(1000);
    }
    if (!emailFilled) {
      const inputs = await page.$$eval('input', els => els.map(x => ({
        type: x.type, placeholder: x.placeholder, name: x.name
      }))).catch(() => []);
      throw new Error(`Email field not found after 40s. URL: ${page.url()}, inputs: ${JSON.stringify(inputs)}`);
    }

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    log('After email, URL:', page.url());

    // ── Step 3: Pick account (if "Pick an account" screen) ───────────────────
    const pickSelectors = [
      `div[data-test-id="${account.email}"]`,
      `button[aria-label*="${account.email}"]`,
      `[aria-label*="${account.email}"]`,
      `div:has-text("${account.email}")`,
    ];
    for (const sel of pickSelectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 1000 })) {
          log('Picking account:', sel);
          await loc.click();
          await page.waitForTimeout(2000);
          break;
        }
      } catch {}
    }

    // ── Step 4: Fill password ────────────────────────────────────────────────
    log('Waiting for password field (45s)...');
    await page.waitForSelector('input[type="password"]', { timeout: 45000 });
    await page.fill('input[type="password"]', account.password);
    await page.waitForTimeout(500);
    const submitted = await page
      .locator('input[type="submit"]').first().click({ timeout: 5000 })
      .then(() => true).catch(() => false);
    if (!submitted) {
      await page.locator('button:has-text("Sign in")').first().click();
    }

    // ── Step 5: MFA ──────────────────────────────────────────────────────────
    await page.waitForTimeout(2500);
    const pickerDeadline = Date.now() + 15000;
    let methodPicked = false;

    while (Date.now() < pickerDeadline && !methodPicked) {
      const txt = await page.locator('body').innerText().catch(() => '');
      if (/Verify your identity|Approve a request on my Microsoft Authenticator/i.test(txt)) {
        const candidates = [
          'div[data-value="PhoneAppNotification"]',
          'div:has-text("Approve a request on my Microsoft Authenticator app")',
        ];
        for (const sel of candidates) {
          try {
            const loc = page.locator(sel).first();
            if (await loc.isVisible({ timeout: 800 })) {
              log('Picking Authenticator method:', sel);
              await loc.click();
              methodPicked = true;
              await page.waitForTimeout(2000);
              break;
            }
          } catch {}
        }
        break;
      }
      await page.waitForTimeout(500);
    }
    if (methodPicked) log('MFA method picked');

    // ── Step 6: Detect MFA number ─────────────────────────────────────────────
    log('Waiting for MFA number...');
    let mfaNumber = null;
    const mfaDeadline = Date.now() + 45000;

    while (Date.now() < mfaDeadline) {
      const txt = await page.locator('body').innerText().catch(() => '');
      let m = txt.match(/Approve sign in request[\s\S]{0,300}?(\d{2,3})/);
      if (!m) m = txt.match(/enter the number[\s\S]{0,300}?(\d{2,3})/i);
      if (!m) {
        const sign = await page.locator('#idRichContext_DisplaySign').textContent().catch(() => '');
        if (sign && /^\d{2,3}$/.test(sign.trim())) {
          mfaNumber = sign.trim();
          break;
        }
      }
      if (m) { mfaNumber = m[1]; break; }
      if (/Stay signed in|Tetap masuk/i.test(txt)) break;
      await page.waitForTimeout(500);
    }

    if (mfaNumber) {
      log(`MFA number detected: ${mfaNumber}`);
      sendTelegram(
        `🔐 *Star Login [${accountCode}]*\n\n` +
        `Buka *Microsoft Authenticator*, tap *${mfaNumber}* untuk approve.\n\n` +
        `Dealer: ${account.dealerName}\n` +
        `Waktu: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })}`
      );
    } else {
      log('No MFA number detected');
      sendTelegram(`🔐 Star Login [${accountCode}]: cek Microsoft Authenticator untuk approve.`);
    }

    // ── Step 7: Wait for redirect ────────────────────────────────────────────
    const deadline = Date.now() + MFA_WAIT_SECONDS * 1000;
    let onAssist = false;

    while (Date.now() < deadline) {
      const url = page.url();
      if (/assist\.star\.astra\.co\.id/.test(url)) {
        onAssist = true;
        break;
      }
      const txt = await page.locator('body').innerText().catch(() => '');
      if (!/Stay signed in|Tetap masuk/i.test('')) {
        const kmsiOk = await page.locator('input[type="submit"][value="Yes"], button:has-text("Yes")').first()
          .click({ timeout: 2000 }).then(() => true).catch(() => false);
        if (kmsiOk) {
          log('Clicked KMSI Yes');
          await page.waitForTimeout(2000);
        }
      }
      if (/We didn't hear from your phone|MFA denied/i.test(txt)) {
        throw new Error('MFA approval failed or denied');
      }
      await page.waitForTimeout(1500);
    }
    if (!onAssist) {
      throw new Error(`Did not redirect to ASSIST within ${MFA_WAIT_SECONDS}s. URL: ${page.url()}`);
    }

    log('Logged in. Waiting for app to fetch token...');
    await page.waitForTimeout(5000);

    // ── Step 8: Capture JWT from localStorage ────────────────────────────────
    let access_token = null;
    let refresh_token = null;
    let id_token = null;
    let oidcUser = null;
    const tokenDeadline = Date.now() + 20000;

    while (Date.now() < tokenDeadline && !access_token) {
      const storage = await page.evaluate(() => {
        const dump = (s) => {
          const out = {};
          for (let i = 0; i < s.length; i++) {
            const k = s.key(i);
            out[k] = s.getItem(k);
          }
          return out;
        };
        return { local: dump(localStorage), session: dump(sessionStorage) };
      });

      // Method 1: oidc.user:*star_api*
      for (const [k, v] of Object.entries(storage.local || {})) {
        if (/oidc\.user/i.test(k) && typeof v === 'string') {
          try {
            const parsed = JSON.parse(v);
            if (parsed.access_token) {
              access_token = parsed.access_token;
              refresh_token = parsed.refresh_token || null;
              id_token = parsed.id_token || null;
              oidcUser = parsed;
              log(`JWT found in oidc blob key: ${k}`);
              break;
            }
          } catch {}
        }
      }
      if (access_token) break;

      // Method 2: JWT scan in localStorage
      for (const [k, v] of Object.entries(storage.local || {})) {
        if (typeof v === 'string' && /eyJ[A-Za-z0-9_-]{20,}\.eyJ/.test(v)) {
          const m = v.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
          if (m) {
            const p = decodeJwtPayload(m[0]);
            if (p && JSON.stringify(p.aud || '').includes('star_api')) {
              access_token = m[0];
              log(`JWT found via scan in key: ${k}`);
              break;
            }
          }
        }
      }
      if (access_token) break;

      await page.waitForTimeout(2000);
    }

    // Fallback: scan captured network tokens
    if (!access_token) {
      log('Fallback: scanning captured network tokens...');
      for (const t of captured.tokens) {
        const p = decodeJwtPayload(t.token);
        if (p && JSON.stringify(p.aud || '').includes('star_api')) {
          access_token = t.token;
          log('JWT found in network capture');
          break;
        }
      }
    }

    if (!access_token) {
      throw new Error('Login completed but no star_api access_token captured');
    }

    // ── Step 9: Save JWT ─────────────────────────────────────────────────────
    const jwtFile = VAULT.saveJwt(accountCode, access_token);
    const exp = decodeJwtPayload(access_token);
    const expStr = exp ? new Date(exp.exp * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Makassar' }) : 'unknown';

    log(`✅ JWT saved to ${jwtFile}`);
    log(`    expires: ${expStr}`);
    sendTelegram(
      `✅ *Login Star BERHASIL [${accountCode}]*\n\n` +
      `Dealer  : ${account.dealerName}\n` +
      `JWT file : ${jwtFile}\n` +
      `Expires  : ${expStr}`
    );

    // ── Step 10: Set as active if this is the first/only account ─────────────
    const accounts = VAULT.listAccounts();
    if (accounts.length === 1) {
      VAULT.setActiveAccount(accountCode);
      log(`Set ${accountCode} as active account`);
    }

    return { accountCode, jwtFile, expiresAt: expStr };

  } catch (err) {
    log('❌ ERROR:', err.message);
    sendTelegram(`❌ *Login Star GAGAL [${accountCode}]*\n\nError: ${err.message.slice(0, 400)}`);

    // Save screenshot for debugging
    try {
      const errPng = path.join(LOG_DIR, `login-star-${accountCode}-error.png`);
      await page.screenshot({ path: errPng, fullPage: true });
      log('Saved error screenshot:', errPng);
    } catch {}

    throw err;
  } finally {
    await browser.close();
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────
runLogin()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
