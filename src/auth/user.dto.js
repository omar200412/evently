'use strict';

/**
 * What a user looks like on the wire.
 *
 * An allowlist, built field by field, and never `{ ...user }` or a `delete
 * user.passwordHash`. The difference matters more than it looks: a spread
 * serialises whatever the row happens to contain, so the day someone adds a
 * `mfaSecret` or a `resetToken` column it ships to every client that ever asks
 * for a user — and nothing fails, so nobody notices. Listing the safe fields
 * means new columns are private until somebody decides otherwise.
 *
 * This is the only way a user reaches a response body. There is a test that
 * greps every auth response for `passwordHash` to keep it that way.
 */
function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

module.exports = { toPublicUser };
