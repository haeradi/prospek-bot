'use strict';
const PASSWORD_SELECTOR = 'input[type="password"], input[name="passwd"], #i0118';
const DASHBOARD_SELECTOR = 'nav, [role="navigation"], [data-testid*="dashboard" i], [class*="dashboard" i], a[href*="logout" i], button[aria-label*="profile" i]';

function classifyLoginSnapshot(s) {
  let u; try { u = new URL(s.url); } catch { return 'unknown'; }
  const pageText = `${s.heading || ''} ${s.bodyText || ''}`;
  if (/no healthy upstream|upstream connect error|service unavailable/i.test(pageText)) return 'upstream_unavailable';
  if (s.passwordVisible || (/microsoftonline\.com$/i.test(u.hostname) && /enter password|masukkan kata sandi/i.test(pageText))) return 'password';
  const assist = u.hostname === 'assist.star.astra.co.id';
  const loginPath = /^\/login(?:\/|$)/i.test(u.pathname);
  if (assist && !loginPath && !s.usernameVisible && s.dashboardVisible) return 'dashboard';
  if (s.accountPickerVisible || s.usernameVisible || loginPath || /microsoftonline\.com$/i.test(u.hostname)) return 'intermediary';
  return 'unknown';
}
function formatLoginDiagnostic(rawUrl, heading) {
  let location = 'alamat-tidak-valid';
  try { const u = new URL(rawUrl); location = `${u.hostname}${u.pathname}`; } catch {}
  const safe = String(heading || 'tanpa judul').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `Halaman login tidak dikenali: ${location} — ${safe || 'tanpa judul'}`;
}
async function visible(page, selector) { return page.locator(selector).first().isVisible().catch(() => false); }
async function snapshot(page) {
  const heading = await page.locator('h1, h2, [role="heading"]').first().textContent().catch(() => '');
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return { url: page.url(), heading, bodyText: bodyText.slice(0, 1000),
    passwordVisible: await visible(page, PASSWORD_SELECTOR),
    usernameVisible: await visible(page, 'input[placeholder*="Username" i], input[type="email"], #i0116'),
    dashboardVisible: await visible(page, DASHBOARD_SELECTOR),
    accountPickerVisible: await visible(page, '[data-test-id], [data-test-id="accountList"], #tilesHolder') };
}
async function clickAccountPicker(page, email) {
  for (const sel of [`button[aria-label*="${email}"]`, `[data-test-id="${email}"]`, '#tilesHolder [role="listitem"]']) {
    const item = page.locator(sel).first();
    if (await item.isVisible().catch(() => false)) { await item.click(); return true; }
  }
  return false;
}
async function recoverBlankAssistLogin(page, options = {}) {
  const snapshotFn = options.snapshotFn || snapshot;
  const sleepFn = options.sleepFn || (ms => page.waitForTimeout(ms));
  const navigateFn = options.navigateFn || ((p, url) => p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }));
  const maxRecoveries = options.maxRecoveries ?? 2;
  let last;
  for (let attempt = 0; attempt <= maxRecoveries; attempt++) {
    last = await snapshotFn(page);
    const state = classifyLoginSnapshot(last);
    if (state !== 'intermediary' || last.usernameVisible || last.accountPickerVisible) return { state, snapshot: last };
    if (attempt === maxRecoveries) break;
    await sleepFn((options.backoffMs || 750) * (attempt + 1));
    await navigateFn(page, `https://assist.star.astra.co.id/login?assist_retry=${attempt + 1}`);
  }
  return { state: 'unknown', snapshot: last };
}
async function waitForPostUsernameState(page, email, options = {}) {
  const deadline = Date.now() + (options.timeout || 30000); let last;
  while (Date.now() < deadline) {
    last = await snapshot(page); const state = classifyLoginSnapshot(last);
    if (state === 'password' || state === 'dashboard') return state;
    if (state === 'intermediary') await clickAccountPicker(page, email).catch(() => false);
    await page.waitForTimeout(options.interval || 500);
  }
  // Microsoft dapat merender input password tepat pada batas timeout.
  // Periksa satu kali lagi sebelum menyatakan halaman tidak dikenal.
  last = await snapshot(page);
  const finalState = classifyLoginSnapshot(last);
  if (finalState === 'password' || finalState === 'dashboard') return finalState;
  if (finalState === 'intermediary' && !last.usernameVisible && !last.accountPickerVisible) {
    const recovered = await recoverBlankAssistLogin(page, options);
    if (recovered.state === 'intermediary' && recovered.snapshot.usernameVisible) return 'entry_retry';
    if (recovered.state === 'upstream_unavailable') throw new Error('ASSIST login upstream unavailable');
  }
  const heading = last.heading || await page.locator('h1, h2, [role="heading"]').first().textContent().catch(() => 'tanpa judul');
  throw new Error(formatLoginDiagnostic(last.url || page.url(), heading));
}
module.exports = { PASSWORD_SELECTOR, classifyLoginSnapshot, formatLoginDiagnostic, recoverBlankAssistLogin, waitForPostUsernameState };