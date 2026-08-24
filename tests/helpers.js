'use strict';

const { SEED, reset } = require('../prisma/seed');
const { disconnect } = require('../src/db/prisma');

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
const USER_IDS = SEED.users.map((user) => user.id);

// Well-formed, and deliberately not seeded. Having it matters because "not
// found" and "not a UUID" are different failures with different statuses, and
// only a valid-but-absent id can exercise the first one.
const ABSENT_UUID = '99999999-0000-4000-8000-000000000999';

module.exports = { SEED, reset, disconnect, VENUE_IDS, EVENT_IDS, USER_IDS, ABSENT_UUID };
