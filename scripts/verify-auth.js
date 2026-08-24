'use strict';

// See scripts/parallel-bookings.js — must precede the src/config require.
process.env.DB_LOG = process.env.DB_LOG || 'silent';

const { execSync } = require('node:child_process');
const jsonwebtoken = require('jsonwebtoken');
const app = require('../src/app');
const config = require('../src/config');
const { prisma, disconnect } = require('../src/db/prisma');
const { SEED, SEED_PASSWORD, reset } = require('../prisma/seed');

/**
 * The security claims, checked against a running server.
 *
 * Everything here is also covered by tests/auth.test.js and
 * tests/authorization.test.js. This exists anyway because those run inside Jest
 * against an app object, and this drives a real listening socket end to end —
 * and because a security posture is worth being able to state in one page of
 * output that someone can read without knowing Jest.
 *
 * Exits non-zero on any failure, so it belongs in CI next to the tests.
 *
 *   npm run verify:auth
 */

const results = [];

function check(group, claim, passed, detail) {
  results.push({ group, claim, passed, detail });
}

async function main() {
  execSync('npx prisma migrate deploy', { stdio: 'pipe' });
  await reset();

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const [organizerA, organizerB, attendee] = SEED.users;

  const call = async (path, { method = 'GET', token, cookie, body, raw } = {}) => {
    const headers = {};
    // fetch throws outright on a GET with a body, so the caller's `body` is
    // dropped for methods that cannot carry one rather than being an error.
    const sendsBody = body !== undefined && !['GET', 'HEAD'].includes(method);

    if (sendsBody) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (cookie) headers.cookie = `${config.auth.cookieName}=${cookie}`;

    const res = await fetch(base + path, {
      method,
      headers,
      body: sendsBody ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }

    return { status: res.status, body: parsed, text, headers: res.headers, raw };
  };

  const login = (user) =>
    call('/v1/auth/login', {
      method: 'POST',
      body: { email: user.email, password: SEED_PASSWORD },
    });

  const cookieFrom = (res) => {
    const header = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
    const cookie = header.find((entry) => entry.startsWith(`${config.auth.cookieName}=`));
    return cookie ? cookie.split(';')[0].slice(config.auth.cookieName.length + 1) : undefined;
  };

  try {
    // ── Public surface ────────────────────────────────────────────────────
    for (const path of ['/v1/health', '/v1/events', '/v1/venues']) {
      const res = await call(path);
      check('Public routes', `GET ${path} is reachable anonymously`, res.status === 200, res.status);
    }

    // ── Authentication required ───────────────────────────────────────────
    const protectedRoutes = [
      ['POST', '/v1/events'],
      ['GET', '/v1/bookings'],
      ['POST', '/v1/bookings'],
      ['GET', '/v1/auth/me'],
    ];

    for (const [method, path] of protectedRoutes) {
      const res = await call(path, { method, body: {} });
      check('Authentication', `${method} ${path} is 401 without a token`, res.status === 401, res.status);
    }

    // ── Token forgery ─────────────────────────────────────────────────────
    const claims = {
      sub: attendee.id,
      role: 'ORGANIZER',
      iss: 'evently',
      aud: 'evently-api',
      exp: Math.floor(Date.now() / 1000) + 900,
    };

    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const nonePayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const algNone = await call('/v1/auth/me', { token: `${noneHeader}.${nonePayload}.` });
    check('Token forgery', 'alg=none is rejected', algNone.status === 401, algNone.status);

    const wrongKey = jsonwebtoken.sign({ role: 'ORGANIZER' }, 'a-completely-different-secret', {
      algorithm: 'HS256',
      subject: attendee.id,
      issuer: 'evently',
      audience: 'evently-api',
      expiresIn: '15m',
    });
    const forged = await call('/v1/auth/me', { token: wrongKey });
    check('Token forgery', 'a token signed with another key is rejected', forged.status === 401, forged.status);

    const expired = jsonwebtoken.sign({ role: attendee.role }, config.auth.jwtSecret, {
      algorithm: 'HS256',
      subject: attendee.id,
      issuer: 'evently',
      audience: 'evently-api',
      expiresIn: '-1s',
    });
    const stale = await call('/v1/auth/me', { token: expired });
    check('Token forgery', 'an expired token is rejected', stale.status === 401, stale.status);

    const madeUpRole = jsonwebtoken.sign({ role: 'SUPERUSER' }, config.auth.jwtSecret, {
      algorithm: 'HS256',
      subject: attendee.id,
      issuer: 'evently',
      audience: 'evently-api',
      expiresIn: '15m',
    });
    const unknownRole = await call('/v1/auth/me', { token: madeUpRole });
    check('Token forgery', 'a signed token with an unknown role is rejected', unknownRole.status === 401, unknownRole.status);

    // ── Sessions ──────────────────────────────────────────────────────────
    const attendeeLogin = await login(attendee);
    const attendeeToken = attendeeLogin.body.data.accessToken;
    const attendeeCookie = cookieFrom(attendeeLogin);

    check('Sessions', 'login returns an access token', typeof attendeeToken === 'string', attendeeLogin.status);

    const setCookie = (attendeeLogin.headers.getSetCookie
      ? attendeeLogin.headers.getSetCookie()
      : [attendeeLogin.headers.get('set-cookie')]
    ).join(' ');

    check('Sessions', 'refresh cookie is HttpOnly', /HttpOnly/i.test(setCookie));
    check('Sessions', 'refresh cookie is SameSite=Strict', /SameSite=Strict/i.test(setCookie));
    check(
      'Sessions',
      'refresh token is never in the response body',
      !/refreshToken/.test(attendeeLogin.text)
    );

    const stored = await prisma.refreshToken.findMany();
    check(
      'Sessions',
      'refresh token is stored hashed, not in the clear',
      stored.length > 0 && stored.every((row) => row.tokenHash !== attendeeCookie)
    );

    const wrongPassword = await call('/v1/auth/login', {
      method: 'POST',
      body: { email: attendee.email, password: 'not-the-password' },
    });
    const unknownEmail = await call('/v1/auth/login', {
      method: 'POST',
      body: { email: 'nobody@evently.test', password: 'not-the-password' },
    });
    check(
      'Sessions',
      'unknown account and wrong password are indistinguishable',
      wrongPassword.status === unknownEmail.status &&
        wrongPassword.body.error.message === unknownEmail.body.error.message
    );

    // ── Refresh rotation and reuse detection ──────────────────────────────
    const rotated = await call('/v1/auth/refresh', { method: 'POST', cookie: attendeeCookie });
    const rotatedCookie = cookieFrom(rotated);

    check('Refresh rotation', 'a refresh returns a new token', rotated.status === 200 && rotatedCookie !== attendeeCookie);

    const replay = await call('/v1/auth/refresh', { method: 'POST', cookie: attendeeCookie });
    check('Refresh rotation', 'replaying a rotated token is rejected', replay.status === 401, replay.status);

    const afterDetection = await call('/v1/auth/refresh', { method: 'POST', cookie: rotatedCookie });
    check(
      'Refresh rotation',
      'reuse revokes the whole family, including the live token',
      afterDetection.status === 401,
      afterDetection.status
    );

    // ── Role enforcement ──────────────────────────────────────────────────
    const freshAttendee = await login(attendee);
    const attendeeAccess = freshAttendee.body.data.accessToken;

    const organizerALogin = await login(organizerA);
    const organizerAAccess = organizerALogin.body.data.accessToken;

    const organizerBLogin = await login(organizerB);
    const organizerBAccess = organizerBLogin.body.data.accessToken;

    const newEvent = {
      title: 'Verification Event',
      venueId: SEED.venues[0].id,
      startsAt: '2026-10-20T18:00:00.000Z',
      capacity: 10,
    };

    const attendeeCreate = await call('/v1/events', {
      method: 'POST',
      token: attendeeAccess,
      body: newEvent,
    });
    check('Role enforcement', 'an ATTENDEE creating an event is 403', attendeeCreate.status === 403, attendeeCreate.status);

    const organizerCreate = await call('/v1/events', {
      method: 'POST',
      token: organizerAAccess,
      body: newEvent,
    });
    check('Role enforcement', 'an ORGANIZER may create an event', organizerCreate.status === 201, organizerCreate.status);

    const created = organizerCreate.body.data;
    check(
      'Role enforcement',
      'the creator is recorded as the owner',
      created.organizerId === organizerA.id
    );

    const nominated = await call('/v1/events', {
      method: 'POST',
      token: organizerAAccess,
      body: { ...newEvent, organizerId: organizerB.id },
    });
    check(
      'Role enforcement',
      'ownership cannot be set from the request body',
      nominated.status === 400,
      nominated.status
    );

    // ── BOLA ──────────────────────────────────────────────────────────────
    const foreignPatch = await call(`/v1/events/${created.id}`, {
      method: 'PATCH',
      token: organizerBAccess,
      body: { capacity: 1 },
    });
    check('BOLA', "an organizer cannot edit another's event", foreignPatch.status === 404, foreignPatch.status);

    const foreignDelete = await call(`/v1/events/${created.id}`, {
      method: 'DELETE',
      token: organizerBAccess,
    });
    check('BOLA', "an organizer cannot delete another's event", foreignDelete.status === 404, foreignDelete.status);

    const survived = await call(`/v1/events/${created.id}`);
    check('BOLA', 'the event survived both attempts', survived.status === 200, survived.status);

    const theirBooking = await call('/v1/bookings', {
      method: 'POST',
      token: attendeeAccess,
      body: { eventId: created.id, seats: 1 },
    });

    const peek = await call(`/v1/bookings/${theirBooking.body.data.id}`, { token: organizerAAccess });
    check('BOLA', "a user cannot read another's booking", peek.status === 404, peek.status);

    const steal = await call(`/v1/bookings/${theirBooking.body.data.id}`, {
      method: 'DELETE',
      token: organizerAAccess,
    });
    check('BOLA', "a user cannot cancel another's booking", steal.status === 404, steal.status);

    await call('/v1/bookings', {
      method: 'POST',
      token: organizerAAccess,
      body: { eventId: SEED.events[1].id, seats: 1 },
    });

    const myList = await call('/v1/bookings', { token: attendeeAccess });
    check(
      'BOLA',
      'listing bookings returns only the caller’s own',
      myList.body.data.every((booking) => booking.userId === attendee.id) && myList.body.total === 1,
      `total=${myList.body.total}`
    );

    // ── Credential leakage ────────────────────────────────────────────────
    const me = await call('/v1/auth/me', { token: attendeeAccess });
    const signup = await call('/v1/auth/signup', {
      method: 'POST',
      body: { email: 'leak-check@evently.test', name: 'Leak Check', password: 'a-long-enough-password' },
    });

    check(
      'Credential leakage',
      'no response ever serialises a password hash',
      ![me.text, signup.text, attendeeLogin.text].some((text) => /passwordHash|password_hash|\$2[aby]\$/.test(text))
    );

    report();
  } finally {
    server.close();
    await disconnect();
  }
}

function report() {
  let currentGroup = null;

  for (const result of results) {
    if (result.group !== currentGroup) {
      currentGroup = result.group;
      console.log(`\n${currentGroup}\n${'─'.repeat(currentGroup.length)}`);
    }

    const mark = result.passed ? 'PASS' : 'FAIL';
    const detail = result.passed || result.detail === undefined ? '' : `  (got ${result.detail})`;
    console.log(`  ${mark}  ${result.claim}${detail}`);
  }

  const failed = results.filter((result) => !result.passed);

  console.log(`\n${'═'.repeat(60)}`);

  if (failed.length === 0) {
    console.log(`All ${results.length} security assertions passed.`);
  } else {
    console.log(`${failed.length} of ${results.length} security assertions FAILED.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
