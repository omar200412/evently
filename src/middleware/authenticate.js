'use strict';

const jwt = require('../auth/jwt');
const ApiError = require('../utils/ApiError');

/**
 * Turn a Bearer token into `req.user`.
 *
 * This replaces the `currentUser` middleware from session 3, which trusted an
 * `x-user-id` header. That was a documented placeholder; it is now a real
 * signature check, and the header is gone entirely rather than left behind
 * under an environment flag. A development-only authentication bypass is still
 * an authentication bypass — the only question is how it reaches production.
 *
 * `req.user` is `{ sub, role }` and nothing else. Handlers below get identity
 * from the token, never from the request body or a query parameter.
 */
function authenticate(req, res, next) {
  const token = bearerToken(req);

  if (!token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }

  const claims = jwt.verify(token);

  if (!claims) {
    // One message for expired, forged, wrong-issuer and malformed alike. Which
    // of those it was is useful only to someone probing for a token that works.
    return next(ApiError.unauthorized('Invalid or expired access token'));
  }

  req.user = claims;
  return next();
}

/**
 * Pull the token out of `Authorization: Bearer <token>`.
 *
 * The scheme is compared case-insensitively but must actually be "Bearer", and
 * the value must be a single non-empty token. Accepting a bare token without
 * the scheme would be friendlier and is exactly the kind of leniency that makes
 * two parsers disagree about what a request said.
 */
function bearerToken(req) {
  const header = req.get('authorization');

  if (!header) return null;

  const parts = header.split(' ');

  if (parts.length !== 2) return null;
  if (parts[0].toLowerCase() !== 'bearer') return null;
  if (parts[1].trim() === '') return null;

  return parts[1];
}

module.exports = { authenticate };
