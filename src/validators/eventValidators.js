'use strict';

const {
  ErrorBag,
  isPlainObject,
  rejectUnknownFields,
  readString,
  readInt,
  readIsoDate,
} = require('../utils/validation');
const ApiError = require('../utils/ApiError');
const { parsePagination } = require('./queryValidators');

const CREATE_FIELDS = ['title', 'description', 'venueId', 'startsAt', 'capacity'];
const QUERY_FIELDS = ['page', 'limit', 'venue', 'from', 'to'];

function validateListEventsQuery(query) {
  const bag = new ErrorBag();

  rejectUnknownFields(query, QUERY_FIELDS, bag);

  const { page, limit } = parsePagination(query, bag);
  const venueId = readString(query, 'venue', bag, { max: 64 });
  const from = readIsoDate(query, 'from', bag);
  const to = readIsoDate(query, 'to', bag);

  // Semantic check, not a shape check: both dates parsed fine on their own,
  // but a range that runs backwards can only ever return nothing, so it is
  // almost certainly a client bug worth reporting rather than an empty page.
  if (from && to && from.getTime() > to.getTime()) {
    bag.add('from', 'from must be earlier than or equal to to');
  }

  bag.throwIfAny('Invalid query parameters');

  return { page, limit, venueId, from, to };
}

function validateCreateEventBody(body) {
  if (!isPlainObject(body)) {
    throw ApiError.badRequest('Request body must be a JSON object');
  }

  const bag = new ErrorBag();

  rejectUnknownFields(body, CREATE_FIELDS, bag);

  const title = readString(body, 'title', bag, { required: true, min: 3, max: 200 });
  const description = readString(body, 'description', bag, { min: 0, max: 2000 });
  const venueId = readString(body, 'venueId', bag, { required: true, max: 64 });
  const startsAt = readIsoDate(body, 'startsAt', bag, { required: true });
  const capacity = readInt(body, 'capacity', bag, { required: true, min: 1, max: 100000 });

  bag.throwIfAny('Invalid request body');

  return { title, description, venueId, startsAt, capacity };
}

function validateUpdateEventBody(body) {
  if (!isPlainObject(body)) {
    throw ApiError.badRequest('Request body must be a JSON object');
  }

  const bag = new ErrorBag();

  rejectUnknownFields(body, CREATE_FIELDS, bag);

  const title = readString(body, 'title', bag, { min: 3, max: 200 });
  const description = readString(body, 'description', bag, { min: 0, max: 2000 });
  const venueId = readString(body, 'venueId', bag, { max: 64 });
  const startsAt = readIsoDate(body, 'startsAt', bag);
  const capacity = readInt(body, 'capacity', bag, { min: 1, max: 100000 });

  const changes = { title, description, venueId, startsAt, capacity };
  const provided = Object.entries(changes).filter(([, value]) => value !== undefined);

  if (bag.isEmpty && provided.length === 0) {
    bag.add('body', 'Provide at least one field to update');
  }

  bag.throwIfAny('Invalid request body');

  return Object.fromEntries(provided);
}

module.exports = {
  validateListEventsQuery,
  validateCreateEventBody,
  validateUpdateEventBody,
};
