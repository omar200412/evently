'use strict';

const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const config = require('../config');

/**
 * Serializable transactions, with the retry loop they require.
 *
 * Postgres's SERIALIZABLE level does not take locks and make writers wait. It
 * lets concurrent transactions run on their own snapshots and then aborts the
 * ones whose combined effect could not have happened in any serial order. That
 * is exactly what stops two simultaneous bookings from both reading "3 seats
 * left" and both taking 3 — but it means an aborted transaction is a normal,
 * expected outcome, not a failure. Code that does not retry has merely moved
 * the overselling bug into a 500.
 *
 * So the rule is: SERIALIZABLE and a retry loop are one feature. Never use the
 * isolation level without this wrapper.
 */

// 40001 serialization_failure — the transaction Postgres chose to abort.
// 40P01 deadlock_detected — two transactions waiting on each other.
// Both mean "nothing was written, run it again", and neither is a bug.
const RETRYABLE_SQL_STATES = new Set(['40001', '40P01']);

// Prisma's own code for a write conflict / deadlock surfaced through the engine.
const RETRYABLE_PRISMA_CODES = new Set(['P2034']);

/**
 * Decide whether a failure is contention or a real error.
 *
 * The SQLSTATE arrives in a different place depending on how far up the stack
 * the error was wrapped: the driver adapter throws the raw pg error, while the
 * query engine wraps it in a PrismaClientKnownRequestError. Checking one and
 * not the other is how a retry loop ends up silently never retrying, so this
 * walks the whole cause chain.
 */
function isRetryable(error) {
  for (let current = error, depth = 0; current && depth < 5; current = current.cause, depth += 1) {
    if (RETRYABLE_PRISMA_CODES.has(current.code)) return true;
    if (RETRYABLE_SQL_STATES.has(current.code)) return true;

    const meta = current.meta;
    if (meta && RETRYABLE_SQL_STATES.has(meta.code)) return true;

    if (typeof current.message === 'string') {
      if (current.message.includes('could not serialize access')) return true;
      if (current.message.includes('TransactionWriteConflict')) return true;
      if (current.message.includes('deadlock detected')) return true;
    }
  }

  return false;
}

/**
 * How much contention the process has actually seen.
 *
 * Retries are invisible by design — the caller gets a booking and never learns
 * it took three attempts — which makes them impossible to reason about without
 * counting. The concurrency proof reports these, and a rising `exhausted` in
 * production is the signal that the retry budget is too small for the load.
 */
const stats = { transactions: 0, retries: 0, exhausted: 0 };

function getStats() {
  return { ...stats };
}

function resetStats() {
  stats.transactions = 0;
  stats.retries = 0;
  stats.exhausted = 0;
}

/**
 * Wait a bit before retrying, and stagger the waits.
 *
 * Exponential alone is not enough: twenty transactions that all abort at the
 * same instant would all sleep the same 20ms and collide again on the same
 * instant. The jitter is what spreads them out, so each retry round has fewer
 * contenders than the last.
 */
function backoffFor(attempt) {
  const ceiling = config.booking.baseBackoffMs * 2 ** attempt;
  return Math.floor(Math.random() * ceiling);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `work` inside a SERIALIZABLE transaction, retrying on contention.
 *
 * `work` receives the transactional client and MUST use it for every query —
 * a stray call on the outer `prisma` runs outside the transaction and will not
 * be rolled back with it.
 *
 * It must also be safe to run more than once, which is why it holds no state
 * of its own and returns a plain result the caller interprets.
 */
async function runSerializableTransaction(work) {
  const maxAttempts = config.booking.maxRetries + 1;
  let lastError;

  stats.transactions += 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        // Generous, because these are short transactions that may sit behind a
        // few retries; a low timeout here would turn contention into a 500.
        timeout: 10000,
        maxWait: 10000,
      });
    } catch (error) {
      if (!isRetryable(error)) throw error;

      lastError = error;
      stats.retries += 1;

      if (attempt < maxAttempts - 1) await sleep(backoffFor(attempt));
    }
  }

  // Out of retries. This is a genuine 500: the database kept refusing to
  // serialize the work, and pretending otherwise would report a booking that
  // was never written.
  stats.exhausted += 1;

  const exhausted = new Error(
    `Transaction could not be serialized after ${maxAttempts} attempt(s)`
  );
  exhausted.cause = lastError;
  throw exhausted;
}

module.exports = { runSerializableTransaction, isRetryable, getStats, resetStats };
