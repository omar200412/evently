'use strict';

const bookingRepository = require('../repositories/bookingRepository');
const ApiError = require('../utils/ApiError');
const { BOOKING_STATUS } = require('../domain');

const { OUTCOME } = bookingRepository;

/**
 * List the caller's bookings.
 *
 * `userId` is a mandatory parameter, not an optional filter, and it comes from
 * the token. That is the difference between a scoped collection and an
 * information leak: an endpoint that lists everything and merely *offers* a user
 * filter hands over every booking in the system to anyone who omits it — the
 * collection-level form of BOLA, and the one most often missed, because the
 * single-resource route usually gets the ownership check and the list does not.
 */
function list({ page, limit, eventId, status, userId }) {
  return bookingRepository.listPaginated({ page, limit, eventId, status, userId });
}

/**
 * Fetch a booking the caller is entitled to see.
 *
 * 404 rather than 403 for someone else's booking, for the same reason as
 * events: a 403 would confirm the id is real. Note that the ownership check is
 * inside getById rather than bolted onto each caller — cancel() goes through
 * here too, so there is one place to get it right instead of two to keep in step.
 */
async function getById(id, userId) {
  const booking = await bookingRepository.findById(id);

  if (!booking || booking.userId !== userId) {
    throw ApiError.notFound(`Booking not found: ${id}`);
  }

  return booking;
}

/**
 * Create a booking.
 *
 * The three business rules — the event must exist, a user may hold only one
 * active booking per event, and capacity must not be exceeded — are still the
 * rules, but they are no longer *checked* here. They are decided inside one
 * serializable transaction in the repository, because checking them in this
 * layer would mean reading the database, deciding, and then writing: three
 * steps with room between them for another request to take the last seat.
 *
 * What is left here is the translation from outcome to HTTP status, which is
 * the part that genuinely belongs above the database.
 */
async function create({ eventId, seats, userId }) {
  const result = await bookingRepository.book({ eventId, seats, userId });

  switch (result.outcome) {
    case OUTCOME.CREATED:
      return result.booking;

    case OUTCOME.EVENT_NOT_FOUND:
      throw ApiError.unprocessable(`Event not found: ${eventId}`, [
        { field: 'eventId', message: 'eventId must reference an existing event' },
      ]);

    case OUTCOME.DUPLICATE:
      throw ApiError.conflict('You already have an active booking for this event', [
        { field: 'eventId', message: 'Duplicate booking for this user and event' },
      ]);

    case OUTCOME.SOLD_OUT:
      throw ApiError.conflict('Not enough seats remaining for this event', [
        {
          field: 'seats',
          message: `Requested ${seats}, but only ${result.remaining} seat(s) remain`,
        },
      ]);

    default:
      // Unreachable unless a new outcome is added without handling it here.
      // Falling through silently would return 201 with no booking.
      throw new Error(`Unhandled booking outcome: ${result.outcome}`);
  }
}

/**
 * Soft delete: the record stays, its status flips to CANCELLED.
 *
 * Hard-deleting would destroy the audit trail and silently free the seats with
 * no record of who held them. Cancelling twice is a conflict, not a no-op, so a
 * double-submit is visible to the caller instead of looking like success — and
 * the repository decides that with a conditional UPDATE, so two simultaneous
 * cancellations cannot both report success.
 */
async function cancel(id, userId) {
  // Ownership is established before anything is written. Cancelling first and
  // checking after would let one request cancel a stranger's booking and then
  // report a 404 about it.
  await getById(id, userId);

  const cancelled = await bookingRepository.cancel(id);

  if (cancelled) return cancelled;

  // Nothing was updated, and the row exists and is ours — so it was already
  // cancelled. That is a conflict, not a not-found.
  throw ApiError.conflict(`Booking is already cancelled: ${id}`);
}

module.exports = { STATUS: BOOKING_STATUS, list, getById, create, cancel };
