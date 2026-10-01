'use strict';

function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every(Boolean)) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function hasStarApiAudience(aud) {
  return aud === 'star_api' || (Array.isArray(aud) && aud.includes('star_api'));
}

// Intentionally has no logging: callers may pass authorization headers.
function extractCurrentStarApiJwt(authorization, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match) return null;
  const payload = decodeJwtPayload(match[1]);
  if (!payload || !Number.isFinite(payload.exp) || payload.exp <= nowSeconds || !hasStarApiAudience(payload.aud)) return null;
  return match[1];
}

module.exports = { extractCurrentStarApiJwt };
