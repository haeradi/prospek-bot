'use strict';
const PASSWORD_SELECTOR = 'input[type="password"], input[name="passwd"], #i0118';
const DASHBOARD_SELECTOR = 'nav, [role="navigation"], [data-testid*="dashboard" i], [class*="dashboard" i], a[href*="logout" i], button[aria-label*="profile" i]';

function classifyLoginSnapshot(s) {
  let u; try { u = new URL(s.url); } catch { return 'unknown'; }
  if (s.passwordVisible) return 'password';
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
  return { url: page.url(), passwordVisible: await visible(page, PASSWORD_SELECTOR),
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
async function waitForPostUsernameState(page, email, options = {}) {
  const deadline = Date.now() + (options.timeout || 30000); let last;
  while (Date.now() < deadline) {
    last = await snapshot(page); const state = classifyLoginSnapshot(last);
    if (state === 'password' || state === 'dashboard') return state;
    if (state === 'intermediary') await clickAccountPicker(page, email).catch(() => false);
    await page.waitForTimeout(options.interval || 500);
  }
  const heading = await page.locator('h1, h2, [role="heading"]').first().textContent().catch(() => 'tanpa judul');
  throw new Error(formatLoginDiagnostic((last && last.url) || page.url(), heading));
}
module.exports = { PASSWORD_SELECTOR, classifyLoginSnapshot, formatLoginDiagnostic, waitForPostUsernameState };