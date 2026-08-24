'use strict';

const request = require('supertest');
const app = require('../src/app');
const { reset, disconnect, VENUE_IDS, EVENT_IDS, ABSENT_UUID } = require('./helpers');

beforeEach(() => reset());
afterAll(() => disconnect());

describe('GET /v1/venues', () => {
  it('lists venues with pagination metadata', async () => {
    const res = await request(app).get('/v1/venues?limit=2');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 2, total: 3 });
    expect(res.body.data).toHaveLength(2);
  });

  it('orders by name', async () => {
    const res = await request(app).get('/v1/venues');

    const names = res.body.data.map((venue) => venue.name);
    expect(names).toEqual([...names].sort());
  });

  it('gets a venue with 200', async () => {
    const res = await request(app).get(`/v1/venues/${VENUE_IDS[0]}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(VENUE_IDS[0]);
  });

  it('returns 404 for a well-formed id that is not in the table', async () => {
    const res = await request(app).get(`/v1/venues/${ABSENT_UUID}`);

    expect(res.status).toBe(404);
  });

  it('returns 400 for an id that is not a UUID', async () => {
    const res = await request(app).get('/v1/venues/ven_1');

    expect(res.status).toBe(400);
  });
});

describe('GET /v1/health', () => {
  it('reports the database it depends on, not just itself', async () => {
    const res = await request(app).get('/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });
});

describe('referential integrity', () => {
  it('refuses to delete a venue out from under its events', async () => {
    // Not reachable through the API — there is no DELETE /v1/venues — but the
    // constraint is what makes that safe to add later, so it is worth pinning.
    const { prisma } = require('../src/db/prisma');

    await expect(prisma.venue.delete({ where: { id: VENUE_IDS[0] } })).rejects.toThrow();

    const stillThere = await request(app).get(`/v1/events/${EVENT_IDS[1]}`);
    expect(stillThere.status).toBe(200);
  });
});
