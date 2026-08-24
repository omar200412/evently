'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { ROLES } = require('../domain');
const isUuid = require('../utils/isUuid');

/**
 * Access tokens.
 *
 * Signed with HS256 and verified with the algorithm pinned. That pinning is not
 * a formality — it is the fix for the oldest JWT vulnerability there is. A
 * verifier that trusts the token's own `alg` header will happily accept
 * `alg: "none"` (no signature at all), or accept an HMAC signed with the
 * public key when it expected RS256. Both let anyone mint a token claiming any
 * subject and any role. The token header does not get a vote here.
 *
 * `issuer` and `audience` are checked for the same reason: a valid token from
 * some other system that happens to share a secret is not a valid token for
 * this API.
 */

const ALGORITHM = 'HS256';
const ISSUER = 'evently';
const AUDIENCE = 'evently-api';

function sign({ userId, role }) {
  return jwt.sign({ role }, config.auth.jwtSecret, {
    algorithm: ALGORITHM,
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: config.auth.accessTokenTtl,
  });
}

/**
 * Verify a token and validate what it claims.
 *
 * A correct signature proves the payload was not tampered with. It does not
 * prove the payload makes sense — a token could be validly signed and still
 * carry a role this application has never heard of, or a subject that is not an
 * id. Checking the shape after checking the signature is what stops a malformed
 * claim from flowing into an authorization decision.
 *
 * Returns null for anything invalid rather than throwing, because every failure
 * here means the same thing to the caller: 401. Distinguishing "expired" from
 * "bad signature" in the response would tell an attacker which of their
 * guesses was closer.
 */
function verify(token) {
  let payload;

  try {
    payload = jwt.verify(token, config.auth.jwtSecret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  } catch {
    return null;
  }

  if (!isUuid(payload.sub)) return null;
  if (!ROLES.includes(payload.role)) return null;

  return { sub: payload.sub, role: payload.role };
}

module.exports = { sign, verify, ALGORITHM, ISSUER, AUDIENCE };
