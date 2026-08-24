'use strict';

const { prisma } = require('../db/prisma');
const { runSerializableTransaction } = require('../db/transaction');
const { BOOKING_STATUS } = require('../domain');
const { pageParams, pageResult } = require('../utils/paginate');

/**
 * Data access for bookings.
 *
 * This is the only repository that needs transactions, because it is the only
 * one where reading and writing have to agree: the capacity check is a decision
 * made from a SELECT and acted on by an INSERT, and anything that can slip
 * between the two oversells the event.
 */

const OUTCOME = Object.freeze({
  CREATED: 'CREATED',
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  DUPLICATE: 'DUPLICATE',
  SOLD_OUT: 'SOLD_OUT',
});

async function listPaginated({ page, limit, eventId, status, userId }) {
  const where = {
    userId,
    ...(eventId && { eventId }),
    ...(status && { status }),
  };

  const { skip, take } = pageParams({ page, limit });

  const [data, total] = await Promise.all([
    prisma.booking.findMany({ where, orderBy: { createdAt: 'asc' }, skip, take }),
    prisma.booking.count({ where }),
  ]);

  return pageResult({ data, total, page, limit });
}

function findById(id) {
  return prisma.booking.findUnique({ where: { id } });
}

/**
 * Seats already taken on an event.
 *
 * Only CONFIRMED rows count. Cancelled ones stay for the audit trail but must
 * release their seats, otherwise one cancelled booking keeps an event full
 * forever. Summing in SQL rather than in JS also means the answer is computed
 * inside whatever transaction asked for it.
 */
async function confirmedSeatsFor(eventId, client = prisma) {
  const { _sum } = await client.booking.aggregate({
    where: { eventId, status: BOOKING_STATUS.CONFIRMED },
    _sum: { seats: true },
  });

  return _sum.seats ?? 0;
}

/**
 * Book seats, or explain why not.
 *
 * The whole decision runs inside one SERIALIZABLE transaction: read the event's
 * capacity, read the seats already taken, and insert — all on one snapshot that
 * Postgres will refuse to commit if a concurrent booking invalidated it. The
 * retry lives in runSerializableTransaction, which is why every read here is
 * repeated on each attempt rather than cached outside the callback.
 *
 * Returns an outcome instead of throwing. HTTP status codes are the service's
 * vocabulary, not the database layer's, and the transaction body has to stay
 * safe to run several times — throwing from inside a retry loop to signal an
 * ordinary business rule would be re-thrown once per attempt.
 *
 * Three cases decide what "insert" means, because the (user_id, event_id) unique
 * constraint allows exactly one row per user per event:
 *
 *   no row yet        → create it
 *   row is CANCELLED  → revive it, and treat that as a fresh booking
 *   row is CONFIRMED  → duplicate, refuse
 *
 * Reviving rather than inserting is what lets the constraint exist at all, and
 * the constraint is the backstop: if two concurrent attempts by the same user
 * somehow both got past the read, the database rejects the second one.
 */
async function book({ eventId, userId, seats }) {
  return runSerializableTransaction(async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true, capacity: true },
    });

    if (!event) return { outcome: OUTCOME.EVENT_NOT_FOUND };

    const existing = await tx.booking.findUnique({
      where: { userId_eventId: { userId, eventId } },
    });

    if (existing && existing.status === BOOKING_STATUS.CONFIRMED) {
      return { outcome: OUTCOME.DUPLICATE };
    }

    const taken = await confirmedSeatsFor(eventId, tx);
    const remaining = event.capacity - taken;

    if (seats > remaining) return { outcome: OUTCOME.SOLD_OUT, remaining };

    const booking = existing
      ? await tx.booking.update({
          where: { id: existing.id },
          data: {
            seats,
            status: BOOKING_STATUS.CONFIRMED,
            cancelledAt: null,
            // A revived booking is a new booking as far as the client is
            // concerned, so it gets a new createdAt. Keeping the original would
            // sort it among bookings that were made months earlier.
            createdAt: new Date(),
          },
        })
      : await tx.booking.create({
          data: { eventId, userId, seats, status: BOOKING_STATUS.CONFIRMED },
        });

    return { outcome: OUTCOME.CREATED, booking };
  });
}

/**
 * Soft delete: the row stays, its status flips to CANCELLED.
 *
 * The status guard is in the WHERE clause on purpose. Reading the row, checking
 * its status and then updating it would let two simultaneous cancellations both
 * see CONFIRMED and both "succeed", which is the same read-then-write race the
 * booking path solves with a transaction — but here a conditional UPDATE is
 * enough, and one statement is cheaper than a transaction.
 *
 * Returns null when nothing was cancelled; the caller distinguishes "no such
 * booking" from "already cancelled".
 */
async function cancel(id) {
  const { count } = await prisma.booking.updateMany({
    where: { id, status: BOOKING_STATUS.CONFIRMED },
    data: { status: BOOKING_STATUS.CANCELLED, cancelledAt: new Date() },
  });

  return count === 1 ? prisma.booking.findUnique({ where: { id } }) : null;
}

module.exports = { OUTCOME, listPaginated, findById, book, cancel };
