'use strict';

const { prisma, disconnect } = require('../src/db/prisma');

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

const users = [
  { id: seedId(USERS, 1), email: 'omar@evently.test', name: 'Omar Khalefa' },
  { id: seedId(USERS, 2), email: 'nour@evently.test', name: 'Nour Adel' },
  { id: seedId(USERS, 3), email: 'sara@evently.test', name: 'Sara Mostafa' },
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
].map((event) => ({
  ...event,
  description: `${event.title} at Evently.`,
  startsAt: new Date(event.startsAt),
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
}));

const SEED = { users, venues, events, parallelUsers };

async function seed() {
  for (const user of [...users, ...parallelUsers]) {
    await prisma.user.upsert({ where: { id: user.id }, update: user, create: user });
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
    'TRUNCATE TABLE "bookings", "events", "venues", "users" RESTART IDENTITY CASCADE'
  );
  await seed();
}

module.exports = { SEED, seed, reset };

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
