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

const config = {
  env: oneOf('NODE_ENV', ['development', 'test', 'production'], 'development'),
  port: integer('PORT', { fallback: 3000, min: 1, max: 65535 }),
  apiPrefix: '/v1',
  databaseUrl,
  // Matches the first seeded user. Ids are UUIDs now, so this is no longer a
  // label the application invents — it has to name a row in the users table or
  // every booking insert fails its foreign key.
  currentUserId: process.env.CURRENT_USER_ID || '11111111-0000-4000-8000-000000000001',
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
  booking: {
    // Serializable transactions abort on conflict rather than blocking, so the
    // booking path has to be prepared to run again. Five is enough headroom for
    // the 20-way contention the concurrency proof throws at it.
    maxRetries: integer('BOOKING_MAX_RETRIES', { fallback: 5, min: 0, max: 20 }),
    baseBackoffMs: integer('BOOKING_BACKOFF_MS', { fallback: 20, min: 1, max: 1000 }),
  },
};

if (problems.length > 0) {
  console.error('Invalid environment configuration:');
  problems.forEach((problem) => console.error(`  - ${problem}`));
  console.error('\nCopy .env.example to .env and fill it in.');
  process.exit(1);
}

module.exports = config;
