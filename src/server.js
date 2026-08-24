'use strict';

const app = require('./app');
const config = require('./config');
const { prisma, disconnect } = require('./db/prisma');

/**
 * Boot, then shut down cleanly.
 *
 * The connection check is here rather than left to the first request so a bad
 * DATABASE_URL fails at startup with a clear message, instead of turning into a
 * 500 for whoever happens to hit the API first.
 */
async function start() {
  try {
    await prisma.$connect();
  } catch (error) {
    console.error('Could not connect to the database:', error.message);
    console.error(`Is Postgres running? Tried: ${config.databaseUrl.replace(/:[^:@]*@/, ':***@')}`);
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    console.log(`Evently API listening on http://localhost:${config.port}${config.apiPrefix}`);
  });

  // Stop accepting connections, let in-flight requests finish, then close the
  // pool. Exiting without this drops open transactions on the floor and leaves
  // Postgres holding connections until it times them out itself.
  async function shutdown(signal) {
    console.log(`\n${signal} received, shutting down.`);

    server.close(async () => {
      await disconnect();
      process.exit(0);
    });

    // A request that never finishes must not keep the process alive forever.
    setTimeout(() => {
      console.error('Shutdown timed out, exiting.');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
