'use strict';

const {
  ErrorBag,
  isPlainObject,
  rejectUnknownFields,
  readString,
  readInt,
} = require('../utils/validation');
const ApiError = require('../utils/ApiError');
const { parsePagination } = require('./queryValidators');
const { STATUS } = require('../services/bookingService');

// userId is deliberately absent. It comes from config.currentUserId, so a
// client that sends one gets a 400 for an unknown field rather than being
// allowed to book on someone else's behalf.
const CREATE_FIELDS = ['eventId', 'seats'];
const QUERY_FIELDS = ['page', 'limit', 'event', 'status'];
const MAX_SEATS_PER_BOOKING = 20;

function validateCreateBookingBody(body) {
  if (!isPlainObject(body)) {
    throw ApiError.badRequest('Request body must be a JSON object');
  }

  const bag = new ErrorBag();

  rejectUnknownFields(body, CREATE_FIELDS, bag);

  const eventId = readString(body, 'eventId', bag, { required: true, max: 64 });
  const seats = readInt(body, 'seats', bag, {
    required: true,
    min: 1,
    max: MAX_SEATS_PER_BOOKING,
  });

  bag.throwIfAny('Invalid request body');

  return { eventId, seats };
}

function validateListBookingsQuery(query) {
  const bag = new ErrorBag();

  rejectUnknownFields(query, QUERY_FIELDS, bag);

  const { page, limit } = parsePagination(query, bag);
  const eventId = readString(query, 'event', bag, { max: 64 });
  const status = readString(query, 'status', bag, { max: 32 });

  if (status !== undefined && !Object.keys(STATUS).includes(status)) {
    bag.add('status', `status must be one of: ${Object.keys(STATUS).join(', ')}`);
  }

  bag.throwIfAny('Invalid query parameters');

  return { page, limit, eventId, status };
}

module.exports = {
  MAX_SEATS_PER_BOOKING,
  validateCreateBookingBody,
  validateListBookingsQuery,
};
