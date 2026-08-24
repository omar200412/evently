'use strict';

// Load .env before anything reads process.env. Values already present in the
// real environment win, which is what makes docker-compose's `environment:`
// block override a developer's local file rather than the other way round.
require('dotenv').config({ quiet: true });

/**
 * Application configuration.
 *
 * Every environment variable the app uses is read and checked here, once, at
 * boot. Nothing else in the codebase touches process.env. The point is that a
 * missing DATABASE_URL kills the process on line one with a message naming the
 * variable, instead of surfacing as a connection error on the first request
 * that happens to hit the database.
 *
 * CURRENT_USER_ID still stands in for authentication. When auth lands it is
 * replaced by req.user.id and nothing else has to change.
 */

const problems = [];

function required(name) {
  const value = process.env[name];

  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(`${name} is required`);
    return undefined;
  }

  return value.trim();
}

function integer(name, { fallback, min, max }) {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw.trim());

  if (!Number.isInteger(value)) {
    problems.push(`${name} must be an integer, got "${raw}"`);
    return fallback;
  }

  if (min !== undefined && value < min) {
    problems.push(`${name} must be >= ${min}, got ${value}`);
    return fallback;
  }

  if (max !== undefined && value > max) {
    problems.push(`${name} must be <= ${max}, got ${value}`);
    return fallback;
  }

  return value;
}

/**
 * Read a secret, and refuse the ones that are not secret.
 *
 * A short JWT signing key is brute-forceable offline: an attacker with one
 * token can grind candidate keys until the signature matches, then mint tokens
 * for any user with any role. So length is checked here, at boot, rather than
 * trusted to whoever wrote the .env — and the placeholder from .env.example is
 * rejected outright, because "it worked locally" is exactly how it reaches
 * production.
 */
function secret(name, { minLength = 32 } = {}) {
  const value = required(name);

  if (value === undefined) return undefined;

  if (value.length < minLength) {
    problems.push(`${name} must be at least ${minLength} characters (got ${value.length})`);
    return undefined;
  }

  if (/^(change-?me|secret|placeholder|your-secret)/i.test(value)) {
    problems.push(`${name} is still the example value — generate a real one`);
    return undefined;
  }

  return value;
}

/** A comma-separated list, empty entries dropped. */
function list(name, fallback) {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') return fallback;

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function boolean(name, fallback) {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') return fallback;

  const value = raw.trim().toLowerCase();

  if (['true', '1', 'yes'].includes(value)) return true;
  if (['false', '0', 'no'].includes(value)) return false;

  problems.push(`${name} must be true or false, got "${raw}"`);
  return fallback;
}

function oneOf(name, allowed, fallback) {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') return fallback;

  const value = raw.trim();

  if (!allowed.includes(value)) {
    problems.push(`${name} must be one of: ${allowed.join(', ')} — got "${value}"`);
    return fallback;
  }

  return value;
}

const databaseUrl = required('DATABASE_URL');

if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
  problems.push('DATABASE_URL must be a postgresql:// connection string');
}

const env = oneOf('NODE_ENV', ['development', 'test', 'production'], 'development');

const config = {
  env,
  port: integer('PORT', { fallback: 3000, min: 1, max: 65535 }),
  apiPrefix: '/v1',
  databaseUrl,
  pagination: {
    defaultPage: 1,
    defaultLimit: 10,
    maxLimit: 100,
  },
  db: {
    // Retried write conflicts are expected control flow, not failures, but
    // Prisma logs every query error regardless. DB_LOG=silent is for the
    // scripts that provoke them deliberately and report them properly.
    silent: process.env.DB_LOG === 'silent',
  },
  auth: {
    jwtSecret: secret('JWT_SECRET'),
    // Short, because an access token cannot be revoked — it is believed until it
    // expires. Fifteen minutes is the window a stolen one stays useful; the
    // refresh token is the revocable half of the pair.
    accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
    refreshTokenTtlDays: integer('REFRESH_TOKEN_TTL_DAYS', { fallback: 7, min: 1, max: 365 }),
    // 12 is the working default. Tests drop it because they hash on nearly every
    // case and bcrypt is deliberately slow — that is the whole point of it.
    bcryptRounds: integer('BCRYPT_ROUNDS', { fallback: env === 'test' ? 4 : 12, min: 4, max: 15 }),
    // Refresh cookies must be Secure in production. Left configurable only so
    // http://localhost works in development.
    cookieSecure: boolean('COOKIE_SECURE', env === 'production'),
    cookieName: 'evently_refresh',
  },
  cors: {
    // An explicit allowlist, not a reflected origin. Echoing back whatever
    // Origin arrives is the same as allowing everyone, but harder to notice.
    origins: list('CORS_ORIGINS', ['http://localhost:3000']),
  },
  booking: {
    // Serializable transactions abort on conflict rather than blocking, so the
    // booking path has to be prepared to run again. Five is enough headroom for
    // the 20-way contention the concurrency proof throws at it.
    maxRetries: integer('BOOKING_MAX_RETRIES', { fallback: 5, min: 0, max: 20 }),
    baseBackoffMs: integer('BOOKING_BACKOFF_MS', { fallback: 20, min: 1, max: 1000 }),
  },
};

// Cookies are only as good as the transport under them, and a Secure=false
// refresh cookie in production is a session handed to anyone on the network.
if (config.env === 'production' && config.auth.cookieSecure === false) {
  problems.push('COOKIE_SECURE cannot be false when NODE_ENV=production');
}

if (config.env === 'production' && config.cors.origins.includes('*')) {
  problems.push('CORS_ORIGINS cannot be * when NODE_ENV=production');
}

if (problems.length > 0) {
  console.error('Invalid environment configuration:');
  problems.forEach((problem) => console.error(`  - ${problem}`));
  console.error('\nCopy .env.example to .env and fill it in.');
  process.exit(1);
}

module.exports = config;
