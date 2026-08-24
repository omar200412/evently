'use strict';

const { spawn } = require('node:child_process');
const { start, connectionString } = require('./local-postgres');

/**
 * Run a command against a local Postgres that lives exactly as long as it does.
 *
 *   node scripts/with-local-db.js npx prisma migrate dev
 *   node scripts/with-local-db.js npm test
 *
 * The embedded server is a child of this process, so it goes away when this
 * process does. That is the point — it means there is no long-running database
 * to remember to shut down, and no chance of a migration running against a
 * server someone left up from last week with a different schema.
 */
async function main() {
  // Joined into one string and handed to a shell, so `npm run with-db -- npx
  // prisma migrate deploy` behaves the way it reads.
  const command = process.argv.slice(2).join(' ');

  if (!command) {
    console.error('Usage: node scripts/with-local-db.js <command> [args...]');
    process.exit(1);
  }

  const server = await start();
  console.log(`Local Postgres up. DATABASE_URL=${connectionString}\n`);

  const child = spawn(command, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: connectionString },
  });

  const stop = async (code) => {
    await server.stop();
    process.exit(code);
  };

  child.on('exit', (code, signal) => stop(signal ? 1 : code ?? 0));
  child.on('error', async (error) => {
    console.error(error);
    await stop(1);
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
}

main().catch((error) => {
  console.error('Could not start local Postgres:', error);
  process.exit(1);
});
