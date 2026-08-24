'use strict';

const { execSync } = require('node:child_process');
const { startTestServer, testConnectionString } = require('../../scripts/local-postgres');

/**
 * Bring up the database the suite runs against, once, before any test file.
 *
 * These are integration tests now. They talk to a real Postgres because the
 * things worth testing in this session — SERIALIZABLE behaviour, a unique
 * constraint, cascading deletes — are database behaviour, and a fake would only
 * ever confirm that the fake works.
 *
 * Set TEST_DATABASE_URL to point the suite at your own server (the one in
 * docker-compose, say) instead of starting one here.
 */
module.exports = async function globalSetup() {
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  } else {
    const server = await startTestServer();
    // globalTeardown runs in this same process, so it can stop what we started.
    globalThis.__EVENTLY_PG__ = server;
    process.env.DATABASE_URL = testConnectionString;
  }

  process.env.NODE_ENV = 'test';

  // migrate deploy, not migrate dev: the suite applies the migrations that are
  // committed, exactly as production would. If a migration is missing or broken
  // the tests fail here rather than passing against a schema Prisma helpfully
  // invented on the fly.
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
};
