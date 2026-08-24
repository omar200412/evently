'use strict';

const request = require('supertest');
const app = require('../src/app');
const { reset, disconnect, VENUE_IDS, EVENT_IDS, USER_IDS, ABSENT_UUID } = require('./helpers');

beforeEach(() => reset());
afterAll(() => disconnect());

async function createEvent(overrides = {}) {
  const res = await request(app)
    .post('/v1/events')
    .send({
      title: 'Capacity Test Event',
      venueId: VENUE_IDS[0],
      startsAt: '2026-09-25T18:00:00.000Z',
      capacity: 5,
      ...overrides,
    });

  return res.body.data;
}

/** Book as somebody other than the default user. */
function bookAs(userId, body) {
  return request(app).post('/v1/bookings').set('x-user-id', userId).send(body);
}

describe('POST /v1/bookings', () => {
  it('creates a confirmed booking with 201', async () => {
    const res = await request(app)
      .post('/v1/bookings')
      .send({ eventId: EVENT_IDS[0], seats: 2 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      eventId: EVENT_IDS[0],
      seats: 2,
      status: 'CONFIRMED',
      userId: USER_IDS[0],
    });
    expect(res.body.data.cancelledAt).toBeNull();
  });

  it('rejects a second active booking for the same event by the same user', async () => {
    await request(app).post('/v1/bookings').send({ eventId: EVENT_IDS[0], seats: 1 });
    const res = await request(app)
      .post('/v1/bookings')
      .send({ eventId: EVENT_IDS[0], seats: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already have an active booking/i);
  });

  it('lets a different user book the same event', async () => {
    await request(app).post('/v1/bookings').send({ eventId: EVENT_IDS[0], seats: 1 });
    const res = await bookAs(USER_IDS[1], { eventId: EVENT_IDS[0], seats: 1 });

    expect(res.status).toBe(201);
  });

  it('rejects a booking that exceeds remaining capacity', async () => {
    const event = await createEvent({ capacity: 5 });
    const res = await request(app).post('/v1/bookings').send({ eventId: event.id, seats: 6 });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/not enough seats/i);
  });

  it('allows booking exactly the remaining capacity', async () => {
    const event = await createEvent({ capacity: 5 });
    const res = await request(app).post('/v1/bookings').send({ eventId: event.id, seats: 5 });

    expect(res.status).toBe(201);
  });

  it('counts seats across users when checking capacity', async () => {
    const event = await createEvent({ capacity: 5 });

    expect((await bookAs(USER_IDS[0], { eventId: event.id, seats: 3 })).status).toBe(201);
    expect((await bookAs(USER_IDS[1], { eventId: event.id, seats: 2 })).status).toBe(201);

    const res = await bookAs(USER_IDS[2], { eventId: event.id, seats: 1 });
    expect(res.status).toBe(409);
  });

  it('frees seats again once a booking is cancelled', async () => {
    const event = await createEvent({ capacity: 5 });
    const created = await request(app).post('/v1/bookings').send({ eventId: event.id, seats: 5 });

    await request(app).delete(`/v1/bookings/${created.body.data.id}`);

    const res = await request(app).post('/v1/bookings').send({ eventId: event.id, seats: 5 });
    expect(res.status).toBe(201);
  });

  it('revives the cancelled row on re-booking rather than inserting a second one', async () => {
    const event = await createEvent({ capacity: 5 });
    const created = await request(app).post('/v1/bookings').send({ eventId: event.id, seats: 2 });

    await request(app).delete(`/v1/bookings/${created.body.data.id}`);
    const again = await request(app).post('/v1/bookings').send({ eventId: event.id, seats: 3 });

    // Same row, because (user_id, event_id) is unique. The alternative — a
    // second row — is what that constraint exists to prevent.
    expect(again.body.data.id).toBe(created.body.data.id);
    expect(again.body.data.seats).toBe(3);
    expect(again.body.data.cancelledAt).toBeNull();

    const list = await request(app).get(`/v1/bookings?event=${event.id}`);
    expect(list.body.total).toBe(1);
  });

  it('rejects an eventId that does not exist with 422', async () => {
    const res = await request(app).post('/v1/bookings').send({ eventId: ABSENT_UUID, seats: 1 });

    expect(res.status).toBe(422);
  });

  it('rejects an eventId that is not a UUID with 400', async () => {
    const res = await request(app).post('/v1/bookings').send({ eventId: 'evt_999', seats: 1 });

    expect(res.status).toBe(400);
  });

  it('refuses a client-supplied userId rather than trusting it', async () => {
    const res = await request(app)
      .post('/v1/bookings')
      .send({ eventId: EVENT_IDS[0], seats: 1, userId: USER_IDS[1] });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      field: 'userId',
      message: 'Unknown field: userId',
    });
  });

  it('rejects zero or negative seats', async () => {
    const res = await request(app).post('/v1/bookings').send({ eventId: EVENT_IDS[0], seats: 0 });

    expect(res.status).toBe(400);
  });

  it('rejects a missing body', async () => {
    const res = await request(app).post('/v1/bookings').send({});

    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON with 400, not 500', async () => {
    const res = await request(app)
      .post('/v1/bookings')
      .set('Content-Type', 'application/json')
      .send('{"eventId":');

    expect(res.status).toBe(400);
  });
});

describe('GET /v1/bookings', () => {
  it('gets a single booking with 200', async () => {
    const created = await request(app)
      .post('/v1/bookings')
      .send({ eventId: EVENT_IDS[0], seats: 1 });
    const res = await request(app).get(`/v1/bookings/${created.body.data.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(created.body.data.id);
  });

  it('returns 404 for a well-formed id that is not in the table', async () => {
    const res = await request(app).get(`/v1/bookings/${ABSENT_UUID}`);

    expect(res.status).toBe(404);
  });

  it('returns 400 for an id that is not a UUID', async () => {
    const res = await request(app).get('/v1/bookings/bkg_999');

    expect(res.status).toBe(400);
  });

  it('lists bookings with pagination metadata', async () => {
    await request(app).post('/v1/bookings').send({ eventId: EVENT_IDS[0], seats: 1 });
    await request(app).post('/v1/bookings').send({ eventId: EVENT_IDS[1], seats: 1 });

    const res = await request(app).get('/v1/bookings?limit=1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 1, total: 2 });
    expect(res.body.data).toHaveLength(1);
  });

  it('filters by status, and total reflects the filtered set', async () => {
    const first = await request(app)
      .post('/v1/bookings')
      .send({ eventId: EVENT_IDS[0], seats: 1 });
    await request(app).post('/v1/bookings').send({ eventId: EVENT_IDS[1], seats: 1 });
    await request(app).delete(`/v1/bookings/${first.body.data.id}`);

    const confirmed = await request(app).get('/v1/bookings?status=CONFIRMED');
    const cancelled = await request(app).get('/v1/bookings?status=CANCELLED');

    expect(confirmed.body.total).toBe(1);
    expect(cancelled.body.total).toBe(1);
  });

  it('rejects an unknown status filter', async () => {
    const res = await request(app).get('/v1/bookings?status=PENDING');

    expect(res.status).toBe(400);
  });
});

describe('DELETE /v1/bookings/:bookingId', () => {
  it('soft deletes: 200, status CANCELLED, record still retrievable', async () => {
    const created = await request(app)
      .post('/v1/bookings')
      .send({ eventId: EVENT_IDS[0], seats: 1 });
    const id = created.body.data.id;

    const res = await request(app).delete(`/v1/bookings/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(res.body.data.cancelledAt).not.toBeNull();

    const after = await request(app).get(`/v1/bookings/${id}`);
    expect(after.status).toBe(200);
    expect(after.body.data.status).toBe('CANCELLED');
  });

  it('rejects cancelling twice', async () => {
    const created = await request(app)
      .post('/v1/bookings')
      .send({ eventId: EVENT_IDS[0], seats: 1 });
    const id = created.body.data.id;

    await request(app).delete(`/v1/bookings/${id}`);
    const res = await request(app).delete(`/v1/bookings/${id}`);

    expect(res.status).toBe(409);
  });

  it('returns 404 when cancelling a booking that never existed', async () => {
    const res = await request(app).delete(`/v1/bookings/${ABSENT_UUID}`);

    expect(res.status).toBe(404);
  });
});

describe('unmatched routes', () => {
  it('returns 404 rather than falling through', async () => {
    const res = await request(app).get('/v1/nope');

    expect(res.status).toBe(404);
  });
});
