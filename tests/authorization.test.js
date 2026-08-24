'use strict';

const jsonwebtoken = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const {
  reset,
  disconnect,
  VENUE_IDS,
  EVENT_IDS,
  ABSENT_UUID,
  ORGANIZER_A,
  ORGANIZER_B,
  ATTENDEE,
  tokenFor,
} = require('./helpers');

beforeEach(() => reset());
afterAll(() => disconnect());

const bearer = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

// Owned by ORGANIZER_A and ORGANIZER_B respectively — the seed alternates them.
const EVENT_OF_A = EVENT_IDS[0];
const EVENT_OF_B = EVENT_IDS[1];

const newEvent = () => ({
  title: 'Authorization Test Event',
  venueId: VENUE_IDS[0],
  startsAt: '2026-09-28T18:00:00.000Z',
  capacity: 10,
});

describe('public routes', () => {
  it.each([
    ['GET', '/v1/health'],
    ['GET', '/v1/events'],
    ['GET', '/v1/venues'],
  ])('%s %s needs no token', async (method, url) => {
    const res = await request(app)[method.toLowerCase()](url);

    expect(res.status).toBe(200);
  });

  it('GET /v1/events/:id needs no token', async () => {
    expect((await request(app).get(`/v1/events/${EVENT_OF_A}`)).status).toBe(200);
  });
});

describe('unauthenticated access to protected routes', () => {
  it.each([
    ['post', '/v1/events'],
    ['patch', `/v1/events/${EVENT_IDS[0]}`],
    ['delete', `/v1/events/${EVENT_IDS[0]}`],
    ['get', '/v1/bookings'],
    ['post', '/v1/bookings'],
    ['get', '/v1/auth/me'],
  ])('%s %s is 401 without a token', async (method, url) => {
    const res = await request(app)[method](url).send({});

    expect(res.status).toBe(401);
  });
});

describe('token validation', () => {
  it('rejects a missing Bearer scheme', async () => {
    const res = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', tokenFor(ATTENDEE));

    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jsonwebtoken.sign({ role: 'ORGANIZER' }, 'a-different-secret-entirely', {
      algorithm: 'HS256',
      subject: ATTENDEE.id,
      issuer: 'evently',
      audience: 'evently-api',
      expiresIn: '15m',
    });

    const res = await request(app).get('/v1/auth/me').set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
  });

  it('rejects alg=none, the classic JWT forgery', async () => {
    // Hand-built, because no sane library will sign this. A verifier that trusts
    // the token's own alg header accepts it with no signature at all — which is
    // why the algorithm is pinned to HS256 rather than read from the token.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: ATTENDEE.id,
        role: 'ORGANIZER',
        iss: 'evently',
        aud: 'evently-api',
        exp: Math.floor(Date.now() / 1000) + 900,
      })
    ).toString('base64url');

    const res = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${header}.${payload}.`);

    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = jsonwebtoken.sign({ role: ATTENDEE.role }, config.auth.jwtSecret, {
      algorithm: 'HS256',
      subject: ATTENDEE.id,
      issuer: 'evently',
      audience: 'evently-api',
      expiresIn: '-1s',
    });

    const res = await request(app).get('/v1/auth/me').set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
  });

  it('rejects a validly signed token carrying a role that does not exist', async () => {
    // Signature checks pass; the claim is still nonsense. Validating the shape
    // after validating the signature is what stops it reaching a role check.
    const odd = jsonwebtoken.sign({ role: 'SUPERUSER' }, config.auth.jwtSecret, {
      algorithm: 'HS256',
      subject: ATTENDEE.id,
      issuer: 'evently',
      audience: 'evently-api',
      expiresIn: '15m',
    });

    const res = await request(app).get('/v1/auth/me').set('Authorization', `Bearer ${odd}`);

    expect(res.status).toBe(401);
  });

  it('rejects a token issued for a different audience', async () => {
    const foreign = jsonwebtoken.sign({ role: ATTENDEE.role }, config.auth.jwtSecret, {
      algorithm: 'HS256',
      subject: ATTENDEE.id,
      issuer: 'evently',
      audience: 'some-other-service',
      expiresIn: '15m',
    });

    const res = await request(app).get('/v1/auth/me').set('Authorization', `Bearer ${foreign}`);

    expect(res.status).toBe(401);
  });
});

describe('role enforcement (function-level authorization)', () => {
  it('an ATTENDEE cannot create an event', async () => {
    const res = await request(app).post('/v1/events').set(bearer(ATTENDEE)).send(newEvent());

    // 403, not 401: the credential is fine, the role is not. Sending 401 would
    // tell a correctly authenticated client to authenticate again, forever.
    expect(res.status).toBe(403);
  });

  it('an ATTENDEE cannot update or delete an event', async () => {
    const patch = await request(app)
      .patch(`/v1/events/${EVENT_OF_A}`)
      .set(bearer(ATTENDEE))
      .send({ capacity: 5 });
    const remove = await request(app).delete(`/v1/events/${EVENT_OF_A}`).set(bearer(ATTENDEE));

    expect(patch.status).toBe(403);
    expect(remove.status).toBe(403);
  });

  it('an ORGANIZER can create an event and owns it', async () => {
    const res = await request(app).post('/v1/events').set(bearer(ORGANIZER_A)).send(newEvent());

    expect(res.status).toBe(201);
    expect(res.body.data.organizerId).toBe(ORGANIZER_A.id);
  });

  it('an organizer cannot nominate someone else as the owner', async () => {
    const res = await request(app)
      .post('/v1/events')
      .set(bearer(ORGANIZER_A))
      .send({ ...newEvent(), organizerId: ORGANIZER_B.id });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      field: 'organizerId',
      message: 'Unknown field: organizerId',
    });
  });

  it('an ORGANIZER still books like anybody else', async () => {
    const res = await request(app)
      .post('/v1/bookings')
      .set(bearer(ORGANIZER_A))
      .send({ eventId: EVENT_OF_B, seats: 1 });

    expect(res.status).toBe(201);
  });
});

describe('BOLA: events', () => {
  it('an organizer cannot update another organizer\'s event', async () => {
    const res = await request(app)
      .patch(`/v1/events/${EVENT_OF_B}`)
      .set(bearer(ORGANIZER_A))
      .send({ capacity: 1 });

    // 404 rather than 403 — a 403 would confirm the id names a real event,
    // which is an enumeration oracle for ids the caller should know nothing of.
    expect(res.status).toBe(404);
  });

  it('an organizer cannot delete another organizer\'s event', async () => {
    const res = await request(app).delete(`/v1/events/${EVENT_OF_B}`).set(bearer(ORGANIZER_A));

    expect(res.status).toBe(404);
  });

  it('the event survives the attempt', async () => {
    await request(app).delete(`/v1/events/${EVENT_OF_B}`).set(bearer(ORGANIZER_A));

    // The status code is not the assertion that matters. This is.
    expect((await request(app).get(`/v1/events/${EVENT_OF_B}`)).status).toBe(200);
  });

  it('an organizer can update and delete their own event', async () => {
    const patch = await request(app)
      .patch(`/v1/events/${EVENT_OF_A}`)
      .set(bearer(ORGANIZER_A))
      .send({ capacity: 42 });

    expect(patch.status).toBe(200);
    expect(patch.body.data.capacity).toBe(42);

    const remove = await request(app).delete(`/v1/events/${EVENT_OF_A}`).set(bearer(ORGANIZER_A));
    expect(remove.status).toBe(200);
  });
});

describe('BOLA: bookings', () => {
  async function bookingBelongingTo(user, eventId = EVENT_OF_A) {
    const res = await request(app)
      .post('/v1/bookings')
      .set(bearer(user))
      .send({ eventId, seats: 1 });

    return res.body.data;
  }

  it('a user cannot read another user\'s booking', async () => {
    const theirs = await bookingBelongingTo(ATTENDEE);

    const res = await request(app).get(`/v1/bookings/${theirs.id}`).set(bearer(ORGANIZER_A));

    expect(res.status).toBe(404);
  });

  it('a user cannot cancel another user\'s booking', async () => {
    const theirs = await bookingBelongingTo(ATTENDEE);

    const res = await request(app).delete(`/v1/bookings/${theirs.id}`).set(bearer(ORGANIZER_A));

    expect(res.status).toBe(404);
  });

  it('the booking is still confirmed after the attempt', async () => {
    const theirs = await bookingBelongingTo(ATTENDEE);

    await request(app).delete(`/v1/bookings/${theirs.id}`).set(bearer(ORGANIZER_A));

    const mine = await request(app).get(`/v1/bookings/${theirs.id}`).set(bearer(ATTENDEE));
    expect(mine.body.data.status).toBe('CONFIRMED');
  });

  it('listing returns only the caller\'s own bookings', async () => {
    await bookingBelongingTo(ATTENDEE, EVENT_OF_A);
    await bookingBelongingTo(ORGANIZER_A, EVENT_OF_B);
    await bookingBelongingTo(ORGANIZER_B, EVENT_OF_B);

    const res = await request(app).get('/v1/bookings').set(bearer(ATTENDEE));

    // The collection-level form of BOLA, and the one most often missed: the
    // single-resource route usually gets an ownership check and the list does not.
    expect(res.body.total).toBe(1);
    expect(res.body.data.every((booking) => booking.userId === ATTENDEE.id)).toBe(true);
  });

  it('an owner can read and cancel their own booking', async () => {
    const mine = await bookingBelongingTo(ATTENDEE);

    expect((await request(app).get(`/v1/bookings/${mine.id}`).set(bearer(ATTENDEE))).status)
      .toBe(200);
    expect((await request(app).delete(`/v1/bookings/${mine.id}`).set(bearer(ATTENDEE))).status)
      .toBe(200);
  });

  it('a booking that does not exist is a 404, same as one you do not own', async () => {
    const res = await request(app).get(`/v1/bookings/${ABSENT_UUID}`).set(bearer(ATTENDEE));

    expect(res.status).toBe(404);
  });
});
