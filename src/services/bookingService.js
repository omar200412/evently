'use strict';

const store = require('../data/store');
const ApiError = require('../utils/ApiError');
const paginate = require('../utils/paginate');
const eventService = require('./eventService');

const STATUS = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
});

function allBookings() {
  return [...store.bookings.values()];
}

/**
 * Seats already taken on an event.
 *
 * Only CONFIRMED bookings count. Cancelled ones stay in the store for history
 * but must release their seats, otherwise a cancelled booking would keep an
 * event full forever.
 */
function confirmedSeatsFor(eventId) {
  return allBookings()
    .filter((booking) => booking.eventId === eventId && booking.status === STATUS.CONFIRMED)
    .reduce((sum, booking) => sum + booking.seats, 0);
}

function findConfirmedBooking(eventId, userId) {
  return allBookings().find(
    (booking) =>
      booking.eventId === eventId &&
      booking.userId === userId &&
      booking.status === STATUS.CONFIRMED
  );
}

function list({ page, limit, eventId, status }) {
  let bookings = allBookings();

  if (eventId) {
    bookings = bookings.filter((booking) => booking.eventId === eventId);
  }

  if (status) {
    bookings = bookings.filter((booking) => booking.status === status);
  }

  bookings.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return paginate(bookings, { page, limit });
}

function getById(id) {
  const booking = store.bookings.get(id);

  if (!booking) {
    throw ApiError.notFound(`Booking not found: ${id}`);
  }

  return booking;
}

/**
 * Create a booking, enforcing the three business rules for this resource:
 * the event must exist, a user may hold only one active booking per event,
 * and the event's capacity must not be exceeded.
 *
 * All three live here rather than in the controller, so the same rules apply
 * no matter what calls the service.
 */
function create({ eventId, seats, userId }) {
  if (!eventService.exists(eventId)) {
    throw ApiError.unprocessable(`Event not found: ${eventId}`, [
      { field: 'eventId', message: 'eventId must reference an existing event' },
    ]);
  }

  const event = eventService.getById(eventId);

  if (findConfirmedBooking(eventId, userId)) {
    throw ApiError.conflict('You already have an active booking for this event', [
      { field: 'eventId', message: 'Duplicate booking for this user and event' },
    ]);
  }

  const taken = confirmedSeatsFor(eventId);
  const remaining = event.capacity - taken;

  if (seats > remaining) {
    throw ApiError.conflict('Not enough seats remaining for this event', [
      { field: 'seats', message: `Requested ${seats}, but only ${remaining} seat(s) remain` },
    ]);
  }

  const id = store.nextId('booking', 'bkg');
  const booking = {
    id,
    eventId,
    userId,
    seats,
    status: STATUS.CONFIRMED,
    createdAt: new Date().toISOString(),
    cancelledAt: null,
  };

  store.bookings.set(id, booking);
  return booking;
}

/**
 * Soft delete: the record stays, its status flips to CANCELLED.
 *
 * Hard-deleting would destroy the audit trail and silently free the seats with
 * no record of who held them. Cancelling twice is a conflict, not a no-op, so
 * a double-submit is visible to the caller instead of looking like success.
 */
function cancel(id) {
  const booking = getById(id);

  if (booking.status === STATUS.CANCELLED) {
    throw ApiError.conflict(`Booking is already cancelled: ${id}`);
  }

  const cancelled = {
    ...booking,
    status: STATUS.CANCELLED,
    cancelledAt: new Date().toISOString(),
  };

  store.bookings.set(id, cancelled);
  return cancelled;
}

module.exports = { STATUS, list, getById, create, cancel, confirmedSeatsFor };
