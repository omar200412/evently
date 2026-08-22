'use strict';

const store = require('../data/store');
const ApiError = require('../utils/ApiError');
const paginate = require('../utils/paginate');

function list({ page, limit }) {
  const venues = [...store.venues.values()].sort((a, b) => a.name.localeCompare(b.name));
  return paginate(venues, { page, limit });
}

function getById(id) {
  const venue = store.venues.get(id);

  if (!venue) {
    throw ApiError.notFound(`Venue not found: ${id}`);
  }

  return venue;
}

/** Existence check that does not throw — used when validating an event's venueId. */
function exists(id) {
  return store.venues.has(id);
}

module.exports = { list, getById, exists };
