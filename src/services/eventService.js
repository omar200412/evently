'use strict';

const eventRepository = require('../repositories/eventRepository');
const venueRepository = require('../repositories/venueRepository');
const ApiError = require('../utils/ApiError');

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

async function create({ title, description, venueId, startsAt, capacity }) {
  // Checked before inserting rather than left to the foreign key, so the client
  // gets a 422 naming venueId instead of a constraint violation the error
  // handler would have to report as a 500.
  if (!(await venueRepository.exists(venueId))) {
    throw ApiError.unprocessable(`Venue not found: ${venueId}`, [
      { field: 'venueId', message: 'venueId must reference an existing venue' },
    ]);
  }

  return eventRepository.create({ title, description, venueId, startsAt, capacity });
}

async function update(id, changes) {
  // getById first so a missing event is a 404 naming the event, not a Prisma
  // "record to update not found" reaching the error handler as a 500.
  await getById(id);

  if (changes.venueId !== undefined && !(await venueRepository.exists(changes.venueId))) {
    throw ApiError.unprocessable(`Venue not found: ${changes.venueId}`, [
      { field: 'venueId', message: 'venueId must reference an existing venue' },
    ]);
  }

  return eventRepository.update(id, changes);
}

async function remove(id) {
  await getById(id);
  return eventRepository.remove(id);
}

module.exports = { list, getById, create, update, remove };
