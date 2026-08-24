'use strict';

const crypto = require('node:crypto');
const config = require('../config');

/**
 * Refresh tokens: the revocable half of the pair.
 *
 * These are opaque random bytes, deliberately not JWTs. A JWT is believed
 * because it verifies, which makes it impossible to take back before it
 * expires — fine for a fifteen-minute access token, useless for something that
 * lives a week and must be killable the moment it is stolen. An opaque token is
 * only valid because a row says so, and a row can be revoked.
 *
 * 32 bytes from the CSPRNG, not Math.random(). Math.random is seeded predictably
 * and is not a security primitive; a session token an attacker can predict is
 * not a session token.
 */

const TOKEN_BYTES = 32;

function generate() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hash a token for storage.
 *
 * SHA-256 rather than bcrypt, and that difference is deliberate. bcrypt is slow
 * on purpose because passwords are low-entropy and guessable; these are 256 bits
 * of randomness, so there is nothing to brute-force and the slowness would only
 * be a cost on every refresh. What matters is that the database never holds the
 * token itself — a dump of this table must not let anyone mint a session.
 *
 * Unsalted, because the lookup is by hash: a per-row salt would mean scanning
 * every row and hashing the candidate against each one.
 */
function hash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function expiryFromNow() {
  const expires = new Date();
  expires.setDate(expires.getDate() + config.auth.refreshTokenTtlDays);
  return expires;
}

/**
 * The cookie the refresh token travels in.
 *
 * httpOnly so JavaScript cannot read it — that is what makes an XSS bug on the
 * front end stop short of stealing a week-long session. sameSite 'strict' so it
 * is not attached to cross-site requests, which is what stops CSRF: an attacker's
 * page can point a form at /v1/auth/refresh, but the browser will not send this.
 * secure in production so it never crosses plain HTTP.
 *
 * path is scoped to the auth routes, so it is not sent on every ordinary API
 * call. A credential that only travels where it is needed has fewer chances to
 * leak into a log or a proxy.
 */
function cookieAttributes() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.auth.cookieSecure,
    path: '/v1/auth',
  };
}

function cookieOptions() {
  return {
    ...cookieAttributes(),
    maxAge: config.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  };
}

/**
 * Attributes for clearing the cookie.
 *
 * Same path and flags, no maxAge — a browser only removes a cookie when those
 * match the one it stored, so this cannot just be `clearCookie(name)`. Express 5
 * additionally refuses maxAge here, since expiring immediately is the whole
 * point.
 */
function clearCookieOptions() {
  return cookieAttributes();
}

module.exports = {
  generate,
  hash,
  expiryFromNow,
  cookieOptions,
  clearCookieOptions,
};
