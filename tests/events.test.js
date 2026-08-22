'use strict';

const request = require('supertest');
const app = require('../src/app');
const store = require('../src/data/store');

beforeEach(() => store.reset());

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

  it('filters by venue, and total reflects the filtered set', async () => {
    const res = await request(app).get('/v1/events?venue=ven_3&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((event) => event.venueId === 'ven_3')).toBe(true);
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
  const valid = {
    title: 'Intro to Testing',
    venueId: 'ven_1',
    startsAt: '2026-09-20T18:00:00.000Z',
    capacity: 50,
  };

  it('creates an event with 201', async () => {
    const res = await request(app).post('/v1/events').send(valid);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ title: 'Intro to Testing', capacity: 50 });
    expect(res.body.data.id).toBeDefined();
  });

  it('rejects unknown body fields instead of silently dropping them', async () => {
    const res = await request(app)
      .post('/v1/events')
      .send({ ...valid, capcity: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      field: 'capcity',
      message: 'Unknown field: capcity',
    });
  });

  it('reports every missing field at once', async () => {
    const res = await request(app).post('/v1/events').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects a venueId that does not exist', async () => {
    const res = await request(app)
      .post('/v1/events')
      .send({ ...valid, venueId: 'ven_999' });

    expect(res.status).toBe(422);
  });
});

describe('single event routes', () => {
  it('gets an event with 200', async () => {
    const res = await request(app).get('/v1/events/evt_1');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('evt_1');
  });

  it('returns 404 for a missing event', async () => {
    const res = await request(app).get('/v1/events/evt_999');

    expect(res.status).toBe(404);
  });

  it('updates an event with 200', async () => {
    const res = await request(app).patch('/v1/events/evt_1').send({ capacity: 90 });

    expect(res.status).toBe(200);
    expect(res.body.data.capacity).toBe(90);
  });

  it('rejects an empty update body', async () => {
    const res = await request(app).patch('/v1/events/evt_1').send({});

    expect(res.status).toBe(400);
  });

  it('deletes an event with 200', async () => {
    const res = await request(app).delete('/v1/events/evt_1');

    expect(res.status).toBe(200);
    expect((await request(app).get('/v1/events/evt_1')).status).toBe(404);
  });
});
