'use strict';

const eventRepository = require('../repositories/eventRepository');
const venueRepository = require('../repositories/venueRepository');
const ApiError = require('../utils/ApiError');

/**
 * Ownership — the object-level half of authorization.
 *
 * The route already established that the caller is an ORGANIZER. That says
 * nothing about *this* event. Without this check, any organizer could edit or
 * delete any other organizer's event by pasting its id into the URL, which is
 * OWASP's number one API risk (BOLA) and the easiest one to ship by accident:
 * every unit test passes, because every test uses its own data.
 *
 * It returns 404, not 403. A 403 confirms the event exists, which hands an
 * attacker a way to enumerate ids they have no business knowing about. From the
 * caller's side the two are the same anyway — there is nothing here for you.
 */
function assertOwnership(event, userId) {
  if (event.organizerId !== userId) {
    throw ApiError.notFound(`Event not found: ${event.id}`);
  }
}

/**
 * List events, filtered then paginated.
 *
 * Both now happen in SQL. The ordering guarantee that mattered in the in-memory
 * version still holds and is still the reason to care: `total` describes the
 * filtered set, because that is what the client is paging through. The
 * repository runs the count with the same WHERE as the page for exactly that.
 */
function list({ page, limit, venueId, from, to }) {
  return eventRepository.listPaginated({ page, limit, venueId, from, to });
}

async function getById(id) {
  const event = await eventRepository.findById(id);

  if (!event) {
    throw ApiError.notFound(`Event not found: ${id}`);
  }

  return event;
}

async function create({ title, description, venueId, startsAt, capacity }, organizerId) {
  // Checked before inserting rather than left to the foreign key, so the client
  // gets a 422 naming venueId instead of a constraint violation the error
  // handler would have to report as a 500.
  if (!(await venueRepository.exists(venueId))) {
    throw ApiError.unprocessable(`Venue not found: ${venueId}`, [
      { field: 'venueId', message: 'venueId must reference an existing venue' },
    ]);
  }

  // organizerId comes from the verified token, never from the body. An owner a
  // client can nominate is not ownership.
  return eventRepository.create({ title, description, venueId, startsAt, capacity, organizerId });
}

async function update(id, changes, userId) {
  // getById first so a missing event is a 404 naming the event, not a Prisma
  // "record to update not found" reaching the error handler as a 500.
  const event = await getById(id);

  assertOwnership(event, userId);

  if (changes.venueId !== undefined && !(await venueRepository.exists(changes.venueId))) {
    throw ApiError.unprocessable(`Venue not found: ${changes.venueId}`, [
      { field: 'venueId', message: 'venueId must reference an existing venue' },
    ]);
  }

  return eventRepository.update(id, changes);
}

async function remove(id, userId) {
  const event = await getById(id);

  assertOwnership(event, userId);

  return eventRepository.remove(id);
}

module.exports = { list, getById, create, update, remove };
