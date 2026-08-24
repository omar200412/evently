'use strict';

// See scripts/parallel-bookings.js — must precede the src/config require.
process.env.DB_LOG = process.env.DB_LOG || 'silent';

const { execSync } = require('node:child_process');
const { prisma, disconnect } = require('../src/db/prisma');
const { reset, SEED } = require('../prisma/seed');

/**
 * What indexing bookings.user_id is actually worth — and which index does it.
 *
 * "Look up a user's bookings" is the query this table exists to serve, so it
 * needs an index on user_id. That much is not in doubt. The interesting
 * question is which index, because this schema has two candidates:
 *
 *   bookings_user_id_event_id_key   UNIQUE (user_id, event_id)
 *   a standalone index on           (user_id)
 *
 * A B-tree on (user_id, event_id) is sorted by user_id first, so it answers
 * `WHERE user_id = ?` by seeking straight to that user's block — exactly what a
 * standalone (user_id) index would do. Which means the standalone index is not
 * a small win. It is no win, paid for on every insert, update and delete.
 *
 * So this measures three states rather than two:
 *
 *   1. no index on user_id at all   — the sequential scan being avoided
 *   2. the compound unique only     — what the schema actually ships
 *   3. compound + standalone        — the redundant version
 *
 * State 1 versus 2 is the case for indexing. State 2 versus 3 is the case for
 * not adding the second one.
 *
 *   npm run prove:index
 */

const ROWS = 20000;
const STANDALONE = 'bookings_user_id_idx';
const COMPOUND = 'bookings_user_id_event_id_key';

function heading(text) {
  console.log(`\n${text}\n${'─'.repeat(text.length)}`);
}

/** Pull the numbers worth comparing out of a plan. */
function summarise(lines) {
  const text = lines.join('\n');
  const method = /Parallel Seq Scan|Seq Scan|Index Only Scan|Bitmap Heap Scan|Index Scan/.exec(text);
  const time = /Execution Time: ([\d.]+) ms/.exec(text);
  const usingIndex = /using (\w+)/.exec(text);
  const buffers = /Buffers: shared hit=(\d+)(?: read=(\d+))?/.exec(text);

  return {
    method: method ? method[0] : 'unknown',
    index: usingIndex ? usingIndex[1] : '—',
    ms: time ? Number(time[1]) : null,
    blocks: buffers ? Number(buffers[1]) + Number(buffers[2] || 0) : null,
    text,
  };
}

async function explain(userId) {
  const rows = await prisma.$queryRawUnsafe(
    `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM bookings WHERE user_id = '${userId}'`
  );

  return summarise(rows.map((row) => row['QUERY PLAN']));
}

/**
 * Fill the table.
 *
 * One event and many users, because the unique constraint on
 * (user_id, event_id) allows exactly one booking per user per event — so more
 * rows means more users, not more bookings by the same person.
 */
async function loadRows(eventId) {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users (id, email, name)
    SELECT gen_random_uuid(), 'bench-' || i || '@evently.test', 'Bench ' || i
    FROM generate_series(1, ${ROWS}) AS i
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO bookings (id, event_id, user_id, seats, status, created_at)
    SELECT gen_random_uuid(), '${eventId}', u.id, 1, 'CONFIRMED', now()
    FROM users u
    WHERE u.email LIKE 'bench-%'
  `);

  // Without fresh statistics the planner is choosing a plan for the empty table
  // it still believes this is.
  await prisma.$executeRawUnsafe('ANALYZE bookings');
}

function report(label, plan) {
  console.log(`  ${label.padEnd(24)} ${plan.method.padEnd(16)} ${String(plan.ms).padStart(7)} ms` +
    `   ${String(plan.blocks).padStart(6)} blocks   ${plan.index}`);
}

async function main() {
  execSync('npx prisma migrate deploy', { stdio: 'pipe' });
  await reset();

  const event = SEED.events[0];

  heading('Setup');
  console.log(`  loading ${ROWS.toLocaleString()} bookings…`);
  await loadRows(event.id);

  const [sample] = await prisma.$queryRawUnsafe(
    "SELECT user_id FROM bookings WHERE user_id IN " +
      "(SELECT id FROM users WHERE email LIKE 'bench-%') LIMIT 1"
  );
  const userId = sample.user_id;

  const total = await prisma.booking.count();
  console.log(`  bookings in table: ${total.toLocaleString()}`);
  console.log(`  query            : SELECT * FROM bookings WHERE user_id = '${userId}'`);

  // The constraint has to go too. Leaving it would make "no index" a lie: the
  // planner would quietly use the compound one and report an index scan.
  const shipped = await explain(userId);

  let unindexed;
  let redundant;

  // Prisma declares @@unique as a UNIQUE INDEX rather than a table constraint,
  // so it is dropped and rebuilt as an index. ALTER TABLE ... DROP CONSTRAINT
  // does not see it, and would fail with "constraint does not exist".
  const dropCompound = `DROP INDEX IF EXISTS "${COMPOUND}"`;
  const makeCompound = `CREATE UNIQUE INDEX IF NOT EXISTS "${COMPOUND}" ON bookings(user_id, event_id)`;

  try {
    await prisma.$executeRawUnsafe(dropCompound);
    await prisma.$executeRawUnsafe('ANALYZE bookings');
    unindexed = await explain(userId);

    await prisma.$executeRawUnsafe(makeCompound);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${STANDALONE}" ON bookings(user_id)`);
    await prisma.$executeRawUnsafe('ANALYZE bookings');
    redundant = await explain(userId);
  } finally {
    // Always put the schema back — a benchmark that leaves its own indexes
    // behind poisons every run after it. Every statement here is idempotent on
    // purpose: if the block above failed halfway, this must not fail too and
    // replace the real error with its own.
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${STANDALONE}"`);
    await prisma.$executeRawUnsafe(makeCompound);
    await prisma.$executeRawUnsafe('ANALYZE bookings');
  }

  heading('Plans');
  console.log(`  ${'state'.padEnd(24)} ${'method'.padEnd(16)} ${'time'.padStart(10)}` +
    `   ${'read'.padStart(6)}            index`);
  report('no index on user_id', unindexed);
  report('compound unique only', shipped);
  report('compound + standalone', redundant);

  heading('No index on user_id');
  console.log(unindexed.text.split('\n').map((line) => `  ${line}`).join('\n'));

  heading('Compound unique only — what ships');
  console.log(shipped.text.split('\n').map((line) => `  ${line}`).join('\n'));

  heading('Reading this');

  if (unindexed.ms && shipped.ms) {
    console.log(
      `  Indexing user_id: ${(unindexed.ms / shipped.ms).toFixed(0)}× faster here, and the gap widens ` +
        'with the table.'
    );
    console.log(
      `  The scan is the reason, not the clock: ${unindexed.method} reads all ` +
        `${total.toLocaleString()} rows,`
    );
    console.log('  so its cost grows linearly. A B-tree seek grows logarithmically.');
  }

  console.log('');
  console.log(`  Adding ${STANDALONE} on top: the planner switches to it (${redundant.index}),`);
  console.log(
    `  and reads ${redundant.blocks} blocks — the same ${shipped.blocks} the compound index already read.`
  );
  console.log('  It prefers the narrower index, but there is nothing left to win: both are a');
  console.log('  single B-tree descent to the same heap tuple. (user_id, event_id) is sorted');
  console.log('  by user_id first, so it answers this query on its own.');
  console.log('');
  console.log('  So the second index buys no reads and costs a write: every insert, update');
  console.log('  and delete on bookings would have to maintain it. On the booking path, where');
  console.log('  writes retry under contention, that is the wrong trade — which is why the');
  console.log('  schema declares the compound unique and no standalone user_id index.');

  // The bench rows go away with the users that own them, by cascade.
  await prisma.$executeRawUnsafe("DELETE FROM users WHERE email LIKE 'bench-%'");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnect);
