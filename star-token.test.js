'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCurrentStarApiJwt } = require('./star-token');

function jwt(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
}

const future = Math.floor(Date.now() / 1000) + 300;

test('extracts a current STAR API JWT from a Bearer authorization header', () => {
  const token = jwt({ aud: 'star_api', exp: future });
  assert.equal(extractCurrentStarApiJwt(`Bearer ${token}`), token);
});

test('accepts STAR API JWT when aud is an audience array', () => {
  const token = jwt({ aud: ['openid', 'star_api'], exp: future });
  assert.equal(extractCurrentStarApiJwt(`Bearer ${token}`), token);
});

test('rejects malformed, non-Bearer, expired, and wrong-audience authorization headers', () => {
  const valid = jwt({ aud: 'star_api', exp: future });
  assert.equal(extractCurrentStarApiJwt(valid), null);
  assert.equal(extractCurrentStarApiJwt(`Basic ${valid}`), null);
  assert.equal(extractCurrentStarApiJwt('Bearer malformed'), null);
  assert.equal(extractCurrentStarApiJwt(`Bearer ${jwt({ aud: 'star_api', exp: future - 600 })}`), null);
  assert.equal(extractCurrentStarApiJwt(`Bearer ${jwt({ aud: 'other_api', exp: future })}`), null);
});
