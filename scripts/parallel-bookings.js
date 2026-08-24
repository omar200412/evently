'use strict';

// Set before src/config is loaded, because it is read once at require time.
// This script deliberately provokes write conflicts and reports them itself;
// letting Prisma also dump each one as an error would bury the actual result.
process.env.DB_LOG = process.env.DB_LOG || 'silent';

const { execSync } = require('node:child_process');
const app = require('../src/app');
const { prisma, disconnect } = require('../src/db/prisma');
const { SEED, reset } = require('../prisma/seed');
const { getStats, resetStats } = require('../src/db/transaction');

/**
 * The overselling proof.
 *
 * Twenty people send a booking request for the same five-seat event at the same
 * moment, over real HTTP, through the whole stack. If the capacity check were
 * still a read followed by a write — the way the in-memory version did it —
 * most of them would read "5 remaining" before any of them had written, and the
 * event would sell somewhere north of five seats.
 *
 * A correct run is exactly 5 × 201 and 15 × 409, with the bookings table
 * agreeing. The script exits non-zero if it is not, so it can be run in CI as a
 * test rather than read as a demo.
 *
 *   npm run prove:concurrency
 */

const CAPACITY = 5;
const SEATS_EACH = 1;
const BOOKERS = 20;

function heading(text) {
  console.log(`\n${text}\n${'─'.repeat(text.length)}`);
}

async function createEvent(baseUrl) {
  const res = await fetch(`${baseUrl}/v1/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Concurrency Proof',
      venueId: SEED.venues[0].id,
      startsAt: '2026-09-30T18:00:00.000Z',
      capacity: CAPACITY,
    }),
  });

  const body = await res.json();
  return body.data;
}

/**
 * Build every request first, then await them together.
 *
 * This is the part that makes the test a test. Awaiting inside a loop would
 * serialise the attempts, and serial bookings never had a bug to begin with.
 */
function fireAllAtOnce(baseUrl, eventId) {
  const attempts = SEED.parallelUsers.slice(0, BOOKERS).map(async (user) => {
    const started = Date.now();

    const res = await fetch(`${baseUrl}/v1/bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': user.id },
      body: JSON.stringify({ eventId, seats: SEATS_EACH }),
    });

    return { user: user.name, status: res.status, ms: Date.now() - started };
  });

  return Promise.all(attempts);
}

async function main() {
  // Idempotent, and makes this runnable against a database that has only just
  // been created — the proof should not need a separate setup step.
  execSync('npx prisma migrate deploy', { stdio: 'pipe' });
  await reset();

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const event = await createEvent(baseUrl);

    heading('Setup');
    console.log(`Event capacity      : ${CAPACITY}`);
    console.log(`Simultaneous bookers: ${BOOKERS}`);
    console.log(`Seats each          : ${SEATS_EACH}`);
    console.log(`Seats demanded      : ${BOOKERS * SEATS_EACH}`);

    resetStats();
    const started = Date.now();
    const results = await fireAllAtOnce(baseUrl, event.id);
    const elapsed = Date.now() - started;
    const retries = getStats();

    const byStatus = results.reduce((counts, result) => {
      counts[result.status] = (counts[result.status] || 0) + 1;
      return counts;
    }, {});

    heading('HTTP responses');
    Object.entries(byStatus)
      .sort(([a], [b]) => Number(a) - Number(b))
      .forEach(([status, count]) => {
        const label = { 201: 'created', 409: 'conflict' }[status] || 'unexpected';
        console.log(`  ${status} ${label.padEnd(10)} ${count}`);
      });
    console.log(`  all ${BOOKERS} settled in ${elapsed}ms`);

    heading('Serialization conflicts');
    console.log(`  transactions run   : ${retries.transactions}`);
    console.log(`  aborted and retried: ${retries.retries}`);
    console.log(`  gave up            : ${retries.exhausted}`);
    console.log('  Postgres aborted those rather than letting them commit a decision');
    console.log('  made from a snapshot another booking had already invalidated.');
    console.log('  Each one ran again against what was actually committed.');

    const { _sum } = await prisma.booking.aggregate({
      where: { eventId: event.id, status: 'CONFIRMED' },
      _sum: { seats: true },
    });
    const confirmedRows = await prisma.booking.count({
      where: { eventId: event.id, status: 'CONFIRMED' },
    });

    heading('What the table actually holds');
    console.log(`  confirmed bookings : ${confirmedRows}`);
    console.log(`  confirmed seats    : ${_sum.seats ?? 0}`);
    console.log(`  event capacity     : ${CAPACITY}`);
    console.log(`  oversold by        : ${Math.max(0, (_sum.seats ?? 0) - CAPACITY)}`);

    // Asserted rather than narrated. A run that oversells has to fail loudly,
    // otherwise this script is just a paragraph that prints numbers.
    const problems = [];
    if ((_sum.seats ?? 0) > CAPACITY) problems.push('event was oversold');
    if (byStatus[201] !== CAPACITY) problems.push(`expected ${CAPACITY} × 201, got ${byStatus[201] ?? 0}`);
    if (byStatus[409] !== BOOKERS - CAPACITY) {
      problems.push(`expected ${BOOKERS - CAPACITY} × 409, got ${byStatus[409] ?? 0}`);
    }
    const failures = results.filter((result) => result.status >= 500);
    if (failures.length > 0) problems.push(`${failures.length} request(s) returned 5xx`);
    if (retries.exhausted > 0) problems.push(`${retries.exhausted} transaction(s) ran out of retries`);

    heading('Result');
    if (problems.length === 0) {
      console.log('  PASS — exactly the capacity was sold, nothing oversold, no 5xx.');
    } else {
      problems.forEach((problem) => console.log(`  FAIL — ${problem}`));
      process.exitCode = 1;
    }
  } finally {
    server.close();
    await disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
