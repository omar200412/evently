'use strict';

const { SEED, SEED_PASSWORD, reset } = require('../prisma/seed');
const { disconnect } = require('../src/db/prisma');
const jwt = require('../src/auth/jwt');
const config = require('../src/config');

/**
 * Shared test fixtures.
 *
 * Ids come from the seed rather than being discovered by listing first, so a
 * test can say "venue three" and mean it. `reset` truncates and re-seeds, which
 * is the direct replacement for the in-memory store.reset() these tests used
 * before there was a database.
 */

const VENUE_IDS = SEED.venues.map((venue) => venue.id);
const EVENT_IDS = SEED.events.map((event) => event.id);
// Named for what they can do, because that is what the authorization tests are
// about. ORGANIZER_A owns the even-indexed seeded events, ORGANIZER_B the rest —
// so there is always an event the caller does not own.
const [ORGANIZER_A, ORGANIZER_B, ATTENDEE] = SEED.users;

// Well-formed, and deliberately not seeded. Having it matters because "not
// found" and "not a UUID" are different failures with different statuses, and
// only a valid-but-absent id can exercise the first one.
const ABSENT_UUID = '99999999-0000-4000-8000-000000000999';

/**
 * Mint a valid access token for a seeded user.
 *
 * Signed by the real signer and verified by the real middleware — this issues a
 * credential, it does not bypass the check. Going through POST /auth/login for
 * every authenticated request instead would add a bcrypt comparison to hundreds
 * of test cases to prove something one test already proves.
 */
function tokenFor(user) {
  return jwt.sign({ userId: user.id, role: user.role });
}

/**
 * Read the refresh cookie out of a response.
 *
 * The token is httpOnly, so a browser would never expose it to script — but the
 * tests are not a browser, and the refresh-rotation cases need the raw value to
 * present it a second time.
 */
function refreshCookieFrom(res) {
  const cookies = res.headers['set-cookie'] || [];
  const cookie = cookies.find((entry) => entry.startsWith(`${config.auth.cookieName}=`));

  if (!cookie) return undefined;

  const value = cookie.split(';')[0].slice(config.auth.cookieName.length + 1);
  return value === '' ? undefined : value;
}

/** The raw Set-Cookie string, for asserting on its attributes. */
function refreshCookieAttributes(res) {
  const cookies = res.headers['set-cookie'] || [];
  return cookies.find((entry) => entry.startsWith(`${config.auth.cookieName}=`)) || '';
}

module.exports = {
  SEED,
  SEED_PASSWORD,
  reset,
  disconnect,
  VENUE_IDS,
  EVENT_IDS,
  ORGANIZER_A,
  ORGANIZER_B,
  ATTENDEE,
  ABSENT_UUID,
  tokenFor,
  refreshCookieFrom,
  refreshCookieAttributes,
};
