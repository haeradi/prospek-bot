// vault-manager.js — credential vault untuk multi-account Star API
'use strict';
const fs = require('fs');
const path = require('path');

const VAULT_FILE = path.join(__dirname, 'star-vault.json');
const JWT_DIR    = __dirname;

// ─── Vault CRUD ──────────────────────────────────────────────────────────────

function loadVault() {
  if (!fs.existsSync(VAULT_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')); }
  catch { return {}; }
}

function saveVault(vault) {
  fs.writeFileSync(VAULT_FILE, JSON.stringify(vault, null, 2), 'utf8');
}

function listAccounts() {
  const vault = loadVault();
  return Object.entries(vault).map(([code, acct]) => ({
    code,
    email: acct.email,
    dealerName: acct.dealerName || code,
    hasPassword: !!(acct.password),
    jwtFile: jwtFilePath(code),
    jwtExists: fs.existsSync(jwtFilePath(code)),
  }));
}

function getAccount(code) {
  const vault = loadVault();
  return vault[code] || null;
}

function addAccount(code, { email, password, dealerName }) {
  const vault = loadVault();
  vault[code] = {
    dealerName: dealerName || code,
    email,
    password,
    createdAt: new Date().toISOString(),
  };
  saveVault(vault);
  return vault[code];
}

function removeAccount(code) {
  const vault = loadVault();
  if (!vault[code]) return false;
  delete vault[code];
  saveVault(vault);
  const jf = jwtFilePath(code);
  if (fs.existsSync(jf)) fs.unlinkSync(jf);
  return true;
}

// ─── JWT file management ────────────────────────────────────────────────────

function jwtFilePath(code) {
  // H704 uses the main jwt.txt (for backward compatibility)
  if (code === 'H704') return path.join(JWT_DIR, 'jwt.txt');
  return path.join(JWT_DIR, `jwt-${code.toLowerCase()}.txt`);
}

function saveJwt(code, token) {
  const jf = jwtFilePath(code);
  fs.writeFileSync(jf, token.trim(), 'utf8');
  return jf;
}

function loadJwt(code) {
  const jf = jwtFilePath(code);
  if (!fs.existsSync(jf)) return null;
  return fs.readFileSync(jf, 'utf8').trim();
}

function setActiveAccount(code) {
  const token = loadJwt(code);
  if (!token) throw new Error(`No JWT found for ${code}`);
  const main = path.join(JWT_DIR, 'jwt.txt');
  fs.writeFileSync(main, token, 'utf8');
  return main;
}

function decodeJwtExp(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return payload.exp || null;
  } catch { return null; }
}

function jwtStatus(code) {
  const token = loadJwt(code);
  if (!token) return { status: 'no_jwt', expiresAt: null, remainingSec: 0, remainingStr: '-' };
  const exp = decodeJwtExp(token);
  if (!exp) return { status: 'unknown', expiresAt: null, remainingSec: 0, remainingStr: '-' };
  const remainingSec = exp - Math.floor(Date.now() / 1000);
  const expiresAt = new Date(exp * 1000);
  const remainingStr = remainingSec > 0
    ? (remainingSec > 86400 ? `${Math.floor(remainingSec/86400)}d` : remainingSec > 3600 ? `${Math.floor(remainingSec/3600)}j` : `${Math.floor(remainingSec/60)}m`)
    : 'EXPIRED';
  let status = 'valid';
  if (remainingSec < 0) status = 'expired';
  else if (remainingSec < 3600) status = 'expiring_soon';
  return { status, expiresAt: expiresAt.toISOString(), remainingSec, remainingStr };
}

function getJwtStatus(code) { return jwtStatus(code); } // alias for external callers

module.exports = {
  listAccounts,
  getAccount,
  addAccount,
  removeAccount,
  saveJwt,
  loadJwt,
  setActiveAccount,
  jwtStatus,
  getJwtStatus,
  decodeJwtExp,
  VAULT_FILE,
};
