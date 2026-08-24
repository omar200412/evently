'use strict';

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/db/prisma');
const { reset, disconnect, SEED, VENUE_IDS, ORGANIZER_A, tokenFor } = require('./helpers');

/**
 * The test this whole session exists for.
 *
 * Twenty people try to take the last seats of a five-seat event at the same
 * moment. The in-memory version passed every other test in this suite and would
 * fail this one: it read the seat count, decided, and then wrote, and twenty
 * requests interleaved in that gap all read "5 remaining".
 *
 * What makes it pass now is not the capacity check — that code barely changed.
 * It is that the check and the insert happen inside one SERIALIZABLE
 * transaction, so Postgres aborts any of them whose result could not have
 * happened in some serial order, and the retry loop runs those again against
 * what actually got committed.
 */

beforeEach(() => reset());
afterAll(() => disconnect());

const CAPACITY = 5;
const BOOKERS = 20;

const bearer = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

async function createCapacityEvent() {
  const res = await request(app)
    .post('/v1/events')
    .set(bearer(ORGANIZER_A))
    .send({
      title: 'Concurrency Proof',
      venueId: VENUE_IDS[0],
      startsAt: '2026-09-30T18:00:00.000Z',
      capacity: CAPACITY,
    });

  return res.body.data;
}

/**
 * Fire all the requests before awaiting any of them.
 *
 * Mapping to promises first and awaiting the array afterwards is the whole
 * point: awaiting inside the loop would run them one after another, which is
 * exactly the scenario that never had a bug.
 */
function bookInParallel(eventId, seats) {
  // Twenty real access tokens for twenty real accounts. Session 3 did this with
  // an x-user-id header, which no longer exists — the proof now goes through
  // signature verification like any other request, which is the point.
  const attempts = SEED.parallelUsers.slice(0, BOOKERS).map((user) =>
    request(app).post('/v1/bookings').set(bearer(user)).send({ eventId, seats })
  );

  return Promise.all(attempts);
}

describe('concurrent bookings', () => {
  it('sells exactly the capacity when 20 users book 1 seat each on a 5-seat event', async () => {
    const event = await createCapacityEvent();
    const responses = await bookInParallel(event.id, 1);

    const created = responses.filter((res) => res.status === 201);
    const conflicts = responses.filter((res) => res.status === 409);

    expect(created).toHaveLength(CAPACITY);
    expect(conflicts).toHaveLength(BOOKERS - CAPACITY);

    // Nothing may fail for any other reason. A 500 here would mean the retry
    // loop gave up and the "no overselling" result above was luck.
    expect(responses.filter((res) => res.status >= 500)).toHaveLength(0);
  });

  it('never commits more seats than the event has', async () => {
    const event = await createCapacityEvent();
    await bookInParallel(event.id, 1);

    const { _sum } = await prisma.booking.aggregate({
      where: { eventId: event.id, status: 'CONFIRMED' },
      _sum: { seats: true },
    });

    // The claim that matters, asserted against the table rather than against
    // the responses: whatever the API said, the database is not oversold.
    expect(_sum.seats).toBe(CAPACITY);
  });

  it('holds when the seat counts differ, so the sum is what is checked', async () => {
    const event = await createCapacityEvent();

    // Two seats each into a five-seat event: two bookings fit, the third does
    // not. A per-booking check would let a third through; only summing catches it.
    const responses = await bookInParallel(event.id, 2);

    const created = responses.filter((res) => res.status === 201);
    expect(created).toHaveLength(2);

    const { _sum } = await prisma.booking.aggregate({
      where: { eventId: event.id, status: 'CONFIRMED' },
      _sum: { seats: true },
    });

    expect(_sum.seats).toBeLessThanOrEqual(CAPACITY);
    expect(_sum.seats).toBe(4);
  });

  it('lets the same user retry safely: one row, whatever the interleaving', async () => {
    const event = await createCapacityEvent();
    const [user] = SEED.parallelUsers;

    // A double-clicked button. The unique constraint on (user_id, event_id) is
    // the backstop here — even if both attempts read "no existing booking", the
    // database refuses the second insert.
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/v1/bookings').set(bearer(user)).send({ eventId: event.id, seats: 1 })
      )
    );

    expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
    expect(responses.filter((res) => res.status >= 500)).toHaveLength(0);

    const rows = await prisma.booking.count({ where: { eventId: event.id, userId: user.id } });
    expect(rows).toBe(1);
  });
});
