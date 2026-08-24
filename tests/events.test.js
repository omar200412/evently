'use strict';

const request = require('supertest');
const app = require('../src/app');
const {
  reset,
  disconnect,
  VENUE_IDS,
  EVENT_IDS,
  ABSENT_UUID,
  ORGANIZER_A,
  ATTENDEE,
  tokenFor,
} = require('./helpers');

beforeEach(() => reset());
afterAll(() => disconnect());

// The seed alternates owners, so ORGANIZER_A owns the even-indexed events.
// Writing to anything else is a BOLA case, covered in authorization.test.js.
const organizer = () => ({ Authorization: `Bearer ${tokenFor(ORGANIZER_A)}` });
const OWNED_EVENT = EVENT_IDS[0];

describe('GET /v1/events', () => {
  it('paginates and reports the total for the whole matching set', async () => {
    const res = await request(app).get('/v1/events?page=1&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toMatchObject({ page: 1, limit: 2, total: 6 });
  });

  it('returns a later page', async () => {
    const res = await request(app).get('/v1/events?page=3&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(6);
  });

  it('returns an empty page past the end without erroring', async () => {
    const res = await request(app).get('/v1/events?page=99&limit=10');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(6);
  });

  it('orders by start time, not by insertion order', async () => {
    const res = await request(app).get('/v1/events?limit=100');

    const times = res.body.data.map((event) => new Date(event.startsAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('filters by venue, and total reflects the filtered set', async () => {
    const res = await request(app).get(`/v1/events?venue=${VENUE_IDS[2]}&limit=2`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((event) => event.venueId === VENUE_IDS[2])).toBe(true);
  });

  it('filters by date range', async () => {
    const res = await request(app).get('/v1/events?from=2026-10-01T00:00:00.000Z');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
  });

  it('rejects a range where from is after to', async () => {
    const res = await request(app).get(
      '/v1/events?from=2026-12-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z'
    );

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      field: 'from',
      message: 'from must be earlier than or equal to to',
    });
  });

  it('rejects a venue filter that is not a UUID', async () => {
    const res = await request(app).get('/v1/events?venue=ven_3');

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      field: 'venue',
      message: 'venue must be a UUID',
    });
  });

  it('rejects unknown query parameters', async () => {
    const res = await request(app).get('/v1/events?sort=title');

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      field: 'sort',
      message: 'Unknown field: sort',
    });
  });

  it('rejects a non-integer page', async () => {
    const res = await request(app).get('/v1/events?page=abc');

    expect(res.status).toBe(400);
  });

  it('rejects a limit above the maximum', async () => {
    const res = await request(app).get('/v1/events?limit=5000');

    expect(res.status).toBe(400);
  });
});

describe('POST /v1/events', () => {
  const valid = () => ({
    title: 'Intro to Testing',
    venueId: VENUE_IDS[0],
    startsAt: '2026-09-20T18:00:00.000Z',
    capacity: 50,
  });

  it('creates an event with 201 and persists it', async () => {
    const res = await request(app).post('/v1/events').set(organizer()).send(valid());

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ title: 'Intro to Testing', capacity: 50 });
    expect(res.body.data.id).toBeDefined();

    // Read it back, so the assertion is about what Postgres stored rather than
    // what the create handler happened to echo.
    const fetched = await request(app).get(`/v1/events/${res.body.data.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.title).toBe('Intro to Testing');
  });

  it('rejects unknown body fields instead of silently dropping them', async () => {
    const res = await request(app)
      .post('/v1/events')
      .set(organizer())
      .send({ ...valid(), capcity: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      field: 'capcity',
      message: 'Unknown field: capcity',
    });
  });

  it('reports every missing field at once', async () => {
    const res = await request(app).post('/v1/events').set(organizer()).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects a venueId that does not exist with 422, not a foreign key 500', async () => {
    const res = await request(app)
      .post('/v1/events')
      .set(organizer())
      .send({ ...valid(), venueId: ABSENT_UUID });

    expect(res.status).toBe(422);
  });

  it('rejects a venueId that is not a UUID with 400', async () => {
    const res = await request(app)
      .post('/v1/events')
      .set(organizer())
      .send({ ...valid(), venueId: 'ven_1' });

    expect(res.status).toBe(400);
  });
});

describe('single event routes', () => {
  it('gets an event with 200', async () => {
    const res = await request(app).get(`/v1/events/${OWNED_EVENT}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(OWNED_EVENT);
  });

  it('returns 404 for a well-formed id that is not in the table', async () => {
    const res = await request(app).get(`/v1/events/${ABSENT_UUID}`);

    expect(res.status).toBe(404);
  });

  it('returns 400 for an id that is not a UUID', async () => {
    const res = await request(app).get('/v1/events/evt_1');

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      field: 'eventId',
      message: 'eventId must be a UUID',
    });
  });

  it('updates an event with 200', async () => {
    const res = await request(app)
      .patch(`/v1/events/${OWNED_EVENT}`)
      .set(organizer())
      .send({ capacity: 90 });

    expect(res.status).toBe(200);
    expect(res.body.data.capacity).toBe(90);
  });

  it('returns 404 when updating an event that does not exist', async () => {
    const res = await request(app)
      .patch(`/v1/events/${ABSENT_UUID}`)
      .set(organizer())
      .send({ capacity: 90 });

    expect(res.status).toBe(404);
  });

  it('rejects an empty update body', async () => {
    const res = await request(app).patch(`/v1/events/${OWNED_EVENT}`).set(organizer()).send({});

    expect(res.status).toBe(400);
  });

  it('deletes an event with 200', async () => {
    const res = await request(app).delete(`/v1/events/${OWNED_EVENT}`).set(organizer());

    expect(res.status).toBe(200);
    expect((await request(app).get(`/v1/events/${OWNED_EVENT}`)).status).toBe(404);
  });

  it('takes the event bookings with it, by cascade', async () => {
    const attendee = { Authorization: `Bearer ${tokenFor(ATTENDEE)}` };

    const booked = await request(app)
      .post('/v1/bookings')
      .set(attendee)
      .send({ eventId: OWNED_EVENT, seats: 1 });

    await request(app).delete(`/v1/events/${OWNED_EVENT}`).set(organizer());

    const res = await request(app).get(`/v1/bookings/${booked.body.data.id}`).set(attendee);
    expect(res.status).toBe(404);
  });
});
