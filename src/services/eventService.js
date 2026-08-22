'use strict';

const store = require('../data/store');
const ApiError = require('../utils/ApiError');
const paginate = require('../utils/paginate');
const venueService = require('./venueService');

function toComparableTime(isoString) {
  return new Date(isoString).getTime();
}

/**
 * List events, filtered then paginated.
 *
 * The order is deliberate. `total` has to describe the filtered set, because
 * that is what the client is paging through — filtering after slicing would
 * report a total for the unfiltered list and hand the client page numbers
 * that don't exist.
 */
function list({ page, limit, venueId, from, to }) {
  let events = [...store.events.values()];

  if (venueId) {
    events = events.filter((event) => event.venueId === venueId);
  }

  if (from) {
    const fromTime = from.getTime();
    events = events.filter((event) => toComparableTime(event.startsAt) >= fromTime);
  }

  if (to) {
    const toTime = to.getTime();
    events = events.filter((event) => toComparableTime(event.startsAt) <= toTime);
  }

  events.sort((a, b) => toComparableTime(a.startsAt) - toComparableTime(b.startsAt));

  return paginate(events, { page, limit });
}

function getById(id) {
  const event = store.events.get(id);

  if (!event) {
    throw ApiError.notFound(`Event not found: ${id}`);
  }

  return event;
}

/** Existence check that does not throw — used by the booking service. */
function exists(id) {
  return store.events.has(id);
}

function create({ title, description, venueId, startsAt, capacity }) {
  if (!venueService.exists(venueId)) {
    throw ApiError.unprocessable(`Venue not found: ${venueId}`, [
      { field: 'venueId', message: 'venueId must reference an existing venue' },
    ]);
  }

  const id = store.nextId('event', 'evt');
  const event = {
    id,
    title,
    description: description ?? '',
    venueId,
    startsAt: startsAt.toISOString(),
    capacity,
  };

  store.events.set(id, event);
  return event;
}

function update(id, changes) {
  const event = getById(id);

  if (changes.venueId !== undefined && !venueService.exists(changes.venueId)) {
    throw ApiError.unprocessable(`Venue not found: ${changes.venueId}`, [
      { field: 'venueId', message: 'venueId must reference an existing venue' },
    ]);
  }

  const updated = {
    ...event,
    ...(changes.title !== undefined && { title: changes.title }),
    ...(changes.description !== undefined && { description: changes.description }),
    ...(changes.venueId !== undefined && { venueId: changes.venueId }),
    ...(changes.startsAt !== undefined && { startsAt: changes.startsAt.toISOString() }),
    ...(changes.capacity !== undefined && { capacity: changes.capacity }),
  };

  store.events.set(id, updated);
  return updated;
}

function remove(id) {
  const event = getById(id);
  store.events.delete(id);
  return event;
}

module.exports = { list, getById, exists, create, update, remove };
