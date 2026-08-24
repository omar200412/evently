'use strict';

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/db/prisma');
const config = require('../src/config');
const {
  reset,
  disconnect,
  SEED_PASSWORD,
  ORGANIZER_A,
  ATTENDEE,
  refreshCookieFrom,
  refreshCookieAttributes,
  tokenFor,
} = require('./helpers');

beforeEach(() => reset());
afterAll(() => disconnect());

const NEW_ACCOUNT = {
  email: 'newcomer@evently.test',
  name: 'New Comer',
  password: 'a-sufficiently-long-password',
};

function login(email = ATTENDEE.email, password = SEED_PASSWORD) {
  return request(app).post('/v1/auth/login').send({ email, password });
}

describe('POST /v1/auth/signup', () => {
  it('creates an account and returns a session', async () => {
    const res = await request(app).post('/v1/auth/signup').send(NEW_ACCOUNT);

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({
      email: NEW_ACCOUNT.email,
      name: NEW_ACCOUNT.name,
      role: 'ATTENDEE',
    });
    expect(typeof res.body.data.accessToken).toBe('string');
  });

  it('never returns the password hash', async () => {
    const res = await request(app).post('/v1/auth/signup').send(NEW_ACCOUNT);

    // Asserted against the whole serialised body, not against known keys — the
    // point is that no field anywhere carries it, including ones added later.
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash/);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('stores a hash, not the password', async () => {
    await request(app).post('/v1/auth/signup').send(NEW_ACCOUNT);

    const user = await prisma.user.findUnique({ where: { email: NEW_ACCOUNT.email } });

    expect(user.passwordHash).not.toBe(NEW_ACCOUNT.password);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('always creates an ATTENDEE, even when the body asks for more', async () => {
    // Privilege escalation via signup. The field is rejected outright rather
    // than ignored, so the attempt is visible instead of looking like it worked.
    const res = await request(app)
      .post('/v1/auth/signup')
      .send({ ...NEW_ACCOUNT, role: 'ORGANIZER' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      field: 'role',
      message: 'Unknown field: role',
    });
  });

  it('refuses a duplicate email without confirming the address is registered', async () => {
    const res = await request(app)
      .post('/v1/auth/signup')
      .send({ ...NEW_ACCOUNT, email: ATTENDEE.email });

    expect(res.status).toBe(409);
    // Must not say "email already in use" — that is a user-enumeration oracle.
    expect(res.body.error.message).not.toMatch(/email|taken|exists|registered/i);
  });

  it('rejects a short password', async () => {
    const res = await request(app)
      .post('/v1/auth/signup')
      .send({ ...NEW_ACCOUNT, password: 'short' });

    expect(res.status).toBe(400);
  });

  it('rejects a malformed email', async () => {
    const res = await request(app)
      .post('/v1/auth/signup')
      .send({ ...NEW_ACCOUNT, email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('normalises the email so case cannot create a second account', async () => {
    await request(app).post('/v1/auth/signup').send({ ...NEW_ACCOUNT, email: 'Mixed@Evently.test' });

    const res = await request(app)
      .post('/v1/auth/signup')
      .send({ ...NEW_ACCOUNT, email: 'mixed@evently.test' });

    expect(res.status).toBe(409);
  });
});

describe('POST /v1/auth/login', () => {
  it('returns a session for correct credentials', async () => {
    const res = await login();

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(ATTENDEE.email);
    expect(typeof res.body.data.accessToken).toBe('string');
  });

  it('rejects a wrong password', async () => {
    const res = await login(ATTENDEE.email, 'definitely-the-wrong-password');

    expect(res.status).toBe(401);
  });

  it('gives the same answer for an unknown account as for a wrong password', async () => {
    const unknown = await login('nobody@evently.test', 'definitely-the-wrong-password');
    const wrongPassword = await login(ATTENDEE.email, 'definitely-the-wrong-password');

    // Identical status and message. Anything else lets an attacker map which
    // addresses have accounts without ever guessing a password.
    expect(unknown.status).toBe(wrongPassword.status);
    expect(unknown.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('puts the refresh token in a cookie and never in the body', async () => {
    const res = await login();

    expect(refreshCookieFrom(res)).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/refreshToken/);
  });

  it('flags the refresh cookie httpOnly and SameSite=Strict', async () => {
    const cookie = refreshCookieAttributes(await login());

    // httpOnly is what stops an XSS bug from lifting a week-long session;
    // SameSite=Strict is what stops another site from spending it.
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/v1\/auth/i);
  });

  it('stores the refresh token hashed, never in the clear', async () => {
    const res = await login();
    const token = refreshCookieFrom(res);

    const rows = await prisma.refreshToken.findMany();

    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toHaveLength(64);
  });
});

describe('POST /v1/auth/refresh', () => {
  it('exchanges a refresh token for a new access token', async () => {
    const token = refreshCookieFrom(await login());

    const res = await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', `${config.auth.cookieName}=${token}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
  });

  it('rotates: the old token stops working and a new one is issued', async () => {
    const first = refreshCookieFrom(await login());

    const rotated = await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', `${config.auth.cookieName}=${first}`);

    const second = refreshCookieFrom(rotated);

    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('detects reuse and revokes the whole family', async () => {
    // The theft scenario. An attacker copies the cookie; the real user refreshes
    // first, so the stolen token is already rotated when the attacker spends it.
    const stolen = refreshCookieFrom(await login());

    const legitimate = await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', `${config.auth.cookieName}=${stolen}`);

    const fresh = refreshCookieFrom(legitimate);

    const replay = await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', `${config.auth.cookieName}=${stolen}`);

    expect(replay.status).toBe(401);

    // And the honest user's current token is dead too. That is the point:
    // there is no way to tell the two parties apart, so both are logged out and
    // whoever knows the password gets back in.
    const afterDetection = await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', `${config.auth.cookieName}=${fresh}`);

    expect(afterDetection.status).toBe(401);

    const live = await prisma.refreshToken.count({ where: { revokedAt: null } });
    expect(live).toBe(0);
  });

  it('rejects a token that was never issued', async () => {
    const res = await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', `${config.auth.cookieName}=not-a-real-token`);

    expect(res.status).toBe(401);
  });

  it('rejects a request with no cookie at all', async () => {
    const res = await request(app).post('/v1/auth/refresh');

    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = refreshCookieFrom(await login());

    await prisma.refreshToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', `${config.auth.cookieName}=${token}`);

    expect(res.status).toBe(401);
  });
});

describe('POST /v1/auth/logout', () => {
  it('revokes the token and clears the cookie', async () => {
    const token = refreshCookieFrom(await login());

    const res = await request(app)
      .post('/v1/auth/logout')
      .set('Cookie', `${config.auth.cookieName}=${token}`);

    expect(res.status).toBe(204);

    const replay = await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', `${config.auth.cookieName}=${token}`);

    expect(replay.status).toBe(401);
  });

  it('is idempotent — logging out twice is not an error', async () => {
    const token = refreshCookieFrom(await login());
    const headers = { Cookie: `${config.auth.cookieName}=${token}` };

    expect((await request(app).post('/v1/auth/logout').set(headers)).status).toBe(204);
    expect((await request(app).post('/v1/auth/logout').set(headers)).status).toBe(204);
  });

  it('does not sign the user out of their other sessions', async () => {
    const laptop = refreshCookieFrom(await login());
    const phone = refreshCookieFrom(await login());

    await request(app)
      .post('/v1/auth/logout')
      .set('Cookie', `${config.auth.cookieName}=${laptop}`);

    const stillWorks = await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', `${config.auth.cookieName}=${phone}`);

    expect(stillWorks.status).toBe(200);
  });
});

describe('GET /v1/auth/me', () => {
  it('returns the authenticated user', async () => {
    const res = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${tokenFor(ORGANIZER_A)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: ORGANIZER_A.id, role: 'ORGANIZER' });
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  it('requires a token', async () => {
    expect((await request(app).get('/v1/auth/me')).status).toBe(401);
  });

  it('rejects a token whose subject has been deleted', async () => {
    const token = tokenFor(ATTENDEE);
    await prisma.user.delete({ where: { id: ATTENDEE.id } });

    const res = await request(app).get('/v1/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});
