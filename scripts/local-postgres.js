'use strict';

const path = require('node:path');
const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');

/**
 * A real Postgres, without Docker.
 *
 * docker-compose.yml is the primary way to run this project's database. This is
 * the fallback for machines that have no Docker, and for the test suite, which
 * needs a database that starts and stops on its own. It is a genuine PostgreSQL
 * server — not an emulator — which matters: the whole point of the booking path
 * is Postgres's SERIALIZABLE implementation, and nothing that merely imitates
 * the wire protocol would prove anything about it.
 */

const USER = 'evently';
const PASSWORD = 'evently';

const PORT = Number(process.env.LOCAL_PG_PORT) || 55432;
const DATABASE = 'evently';
const DATA_DIR = path.join(__dirname, '..', '.pgdata');

// The test cluster is a different server on a different port with its own data
// directory, not just a different database. Tests TRUNCATE between cases, and
// pointing them at the development cluster would quietly delete whatever the
// developer had been working with.
const TEST_PORT = Number(process.env.LOCAL_PG_TEST_PORT) || 55433;
const TEST_DATABASE = 'evently_test';
const TEST_DATA_DIR = path.join(__dirname, '..', '.pgdata-test');

function urlFor({ port, database }) {
  return `postgresql://${USER}:${PASSWORD}@localhost:${port}/${database}?schema=public`;
}

const connectionString = urlFor({ port: PORT, database: DATABASE });
const testConnectionString = urlFor({ port: TEST_PORT, database: TEST_DATABASE });

// The server writes every statement-level ERROR to stderr, including the
// serialization failures the booking path is *supposed* to provoke and retry.
// Left on, a passing test run scrolls past dozens of alarming-looking lines.
// LOCAL_PG_VERBOSE=1 brings them back when you actually want to watch.
const verbose = process.env.LOCAL_PG_VERBOSE === '1';
const relay = verbose ? console.log : () => {};

async function start({ port = PORT, database = DATABASE, dataDir = DATA_DIR } = {}) {
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port,
    persistent: true,
    onLog: relay,
    onError: relay,
  });

  // initialise() is a no-op on an existing cluster but throws if the directory
  // is already populated, so an existing data dir is a normal state, not an error.
  try {
    await server.initialise();
  } catch (error) {
    if (!/already|exists|not empty/i.test(String(error.message))) throw error;
  }

  await server.start();

  try {
    await server.createDatabase(database);
  } catch (error) {
    if (!/already exists/i.test(String(error.message))) throw error;
  }

  return server;
}

/** Start the isolated cluster the test suite uses. */
function startTestServer() {
  return start({ port: TEST_PORT, database: TEST_DATABASE, dataDir: TEST_DATA_DIR });
}

module.exports = {
  start,
  startTestServer,
  connectionString,
  testConnectionString,
  PORT,
  TEST_PORT,
};

// `npm run db:local` — start it and stay up until interrupted.
if (require.main === module) {
  start()
    .then((server) => {
      console.log(`Local Postgres listening on port ${PORT}`);
      console.log(`DATABASE_URL="${connectionString}"`);
      console.log('Ctrl+C to stop.');

      const stop = async () => {
        await server.stop();
        process.exit(0);
      };

      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((error) => {
      console.error('Could not start local Postgres:', error);
      process.exit(1);
    });
}
