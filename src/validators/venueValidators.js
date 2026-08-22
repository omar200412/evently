'use strict';

const { ErrorBag, rejectUnknownFields } = require('../utils/validation');
const { parsePagination } = require('./queryValidators');

const QUERY_FIELDS = ['page', 'limit'];

function validateListVenuesQuery(query) {
  const bag = new ErrorBag();

  rejectUnknownFields(query, QUERY_FIELDS, bag);
  const { page, limit } = parsePagination(query, bag);

  bag.throwIfAny('Invalid query parameters');

  return { page, limit };
}

module.exports = { validateListVenuesQuery };
