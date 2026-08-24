'use strict';

const bcrypt = require('bcryptjs');
const { prisma, disconnect } = require('../src/db/prisma');
const config = require('../src/config');
const { ROLE } = require('../src/domain');

/**
 * Seed data.
 *
 * Two properties matter here, and both are deliberate.
 *
 * The ids are fixed rather than generated. A test that has to first list events
 * to discover an id can only assert that *something* came back; with known ids
 * it can assert which row, and the seed doubles as documentation of what a
 * fresh database contains. They are hand-built UUIDs so they stay readable —
 * 22222222-…-0003 is venue three — while still being valid uuid values.
 *
 * And running it twice is the same as running it once. Every write is an upsert
 * keyed by those fixed ids, so re-seeding a database that already has data
 * updates it back to the known state instead of failing on a duplicate key or
 * quietly inserting a second copy of everything.
 */

const USERS = '11111111';
const VENUES = '22222222';
const EVENTS = '33333333';
const PARALLEL_USERS = '44444444';

/** Build a stable, valid UUID from a group prefix and a small number. */
function seedId(group, n) {
  return `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/**
 * One password for every seeded account, and it is not a secret — it is fixture
 * data, published in the README so the API is usable the moment it starts.
 *
 * Hashed once per process rather than once per user. bcrypt is deliberately
 * slow, the test suite re-seeds before every case, and hashing 23 accounts each
 * time would add minutes to a run for no coverage at all. Real signups go
 * through password.hash() and get their own salt; this shortcut exists only
 * because these rows are known and fake.
 */
const SEED_PASSWORD = 'evently-dev-password';

let cachedHash;

function seedPasswordHash() {
  if (!cachedHash) cachedHash = bcrypt.hashSync(SEED_PASSWORD, config.auth.bcryptRounds);
  return cachedHash;
}

// Two organizers, not one. A single organizer cannot demonstrate the thing that
// matters most about ownership — that one of them may not touch the other's
// events — and the BOLA tests need both sides of that.
const users = [
  { id: seedId(USERS, 1), email: 'omar@evently.test', name: 'Omar Khalefa', role: ROLE.ORGANIZER },
  { id: seedId(USERS, 2), email: 'nour@evently.test', name: 'Nour Adel', role: ROLE.ORGANIZER },
  { id: seedId(USERS, 3), email: 'sara@evently.test', name: 'Sara Mostafa', role: ROLE.ATTENDEE },
];

const venues = [
  { id: seedId(VENUES, 1), name: 'The Grand Hall', city: 'Cairo', capacity: 500 },
  { id: seedId(VENUES, 2), name: 'Riverside Theatre', city: 'Alexandria', capacity: 220 },
  { id: seedId(VENUES, 3), name: 'Tech Park Auditorium', city: 'Cairo', capacity: 120 },
];

const events = [
  {
    id: seedId(EVENTS, 1),
    title: 'Node.js Deep Dive',
    venueId: venues[2].id,
    startsAt: '2026-09-10T18:00:00.000Z',
    capacity: 80,
  },
  {
    id: seedId(EVENTS, 2),
    title: 'Cairo Jazz Night',
    venueId: venues[0].id,
    startsAt: '2026-09-15T20:00:00.000Z',
    capacity: 400,
  },
  {
    id: seedId(EVENTS, 3),
    title: 'Startup Pitch Day',
    venueId: venues[2].id,
    startsAt: '2026-10-01T09:00:00.000Z',
    capacity: 100,
  },
  {
    id: seedId(EVENTS, 4),
    title: 'Shakespeare in the Park',
    venueId: venues[1].id,
    startsAt: '2026-10-12T19:30:00.000Z',
    capacity: 200,
  },
  {
    id: seedId(EVENTS, 5),
    title: 'Design Systems Workshop',
    venueId: venues[2].id,
    startsAt: '2026-11-03T10:00:00.000Z',
    capacity: 40,
  },
  {
    id: seedId(EVENTS, 6),
    title: 'New Year Gala',
    venueId: venues[0].id,
    startsAt: '2026-12-31T21:00:00.000Z',
    capacity: 500,
  },
].map((event, index) => ({
  ...event,
  description: `${event.title} at Evently.`,
  startsAt: new Date(event.startsAt),
  // Alternating owners, so half the catalogue belongs to each organizer and a
  // test can always find an event the caller does not own.
  organizerId: index % 2 === 0 ? users[0].id : users[1].id,
}));

/**
 * Twenty extra users that exist only so the concurrency proof has twenty
 * distinct bookers. One user cannot demonstrate anything here: the unique
 * constraint on (user_id, event_id) would reject their second attempt before
 * the capacity check ever ran, and the run would prove the constraint works
 * rather than that the transaction does.
 */
const parallelUsers = Array.from({ length: 20 }, (unused, index) => ({
  id: seedId(PARALLEL_USERS, index + 1),
  email: `parallel-${index + 1}@evently.test`,
  name: `Parallel Tester ${index + 1}`,
  role: ROLE.ATTENDEE,
}));

const SEED = { users, venues, events, parallelUsers };

async function seed() {
  const passwordHash = seedPasswordHash();

  for (const user of [...users, ...parallelUsers]) {
    const row = { ...user, passwordHash };
    await prisma.user.upsert({ where: { id: row.id }, update: row, create: row });
  }

  for (const venue of venues) {
    await prisma.venue.upsert({ where: { id: venue.id }, update: venue, create: venue });
  }

  for (const event of events) {
    await prisma.event.upsert({ where: { id: event.id }, update: event, create: event });
  }
}

/**
 * Wipe everything and seed again.
 *
 * TRUNCATE rather than deleteMany: it also removes the rows the tests created,
 * which an upsert-based seed would leave behind, and CASCADE handles the
 * foreign keys in one statement instead of forcing a delete order.
 */
async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "refresh_tokens", "bookings", "events", "venues", "users" ' +
      'RESTART IDENTITY CASCADE'
  );
  await seed();
}

module.exports = { SEED, SEED_PASSWORD, seed, reset };

// Only run when invoked directly (`prisma db seed`), not when required by tests.
if (require.main === module) {
  seed()
    .then(async () => {
      const bookings = await prisma.booking.deleteMany();
      console.log(
        `Seeded ${users.length + parallelUsers.length} users, ${venues.length} venues, ` +
          `${events.length} events. Cleared ${bookings.count} booking(s).`
      );
    })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exitCode = 1;
    })
    .finally(disconnect);
}
