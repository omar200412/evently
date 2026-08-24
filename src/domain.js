'use strict';

/**
 * Domain constants shared across layers.
 *
 * These used to hang off bookingService, which meant the booking validators had
 * to import the service just to know what a valid status string is — a
 * validator depending on a service is backwards, and it made the import graph
 * circular once the service started importing repositories. Constants with no
 * behaviour belong on their own.
 *
 * The values match the BookingStatus enum in prisma/schema.prisma exactly. The
 * database is the real enforcement point; this is how the application talks
 * about the same set.
 */

const BOOKING_STATUS = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
});

const BOOKING_STATUSES = Object.freeze(Object.keys(BOOKING_STATUS));

/**
 * Roles, matching the Role enum in prisma/schema.prisma.
 *
 * ATTENDEE is the default and the floor: signing up gets you an account that can
 * book, and nothing more. ORGANIZER is granted, never self-selected — a signup
 * body that could set its own role would make the whole distinction decorative.
 */
const ROLE = Object.freeze({
  ATTENDEE: 'ATTENDEE',
  ORGANIZER: 'ORGANIZER',
});

const ROLES = Object.freeze(Object.keys(ROLE));

module.exports = { BOOKING_STATUS, BOOKING_STATUSES, ROLE, ROLES };
