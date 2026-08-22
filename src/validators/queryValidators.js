'use strict';

const config = require('../config');
const { readInt } = require('../utils/validation');

/**
 * Shared page/limit parsing. Both are optional and fall back to the configured
 * defaults; `limit` is capped so a client cannot ask for the whole table.
 */
function parsePagination(query, bag) {
  const page = readInt(query, 'page', bag, {
    min: 1,
    fallback: config.pagination.defaultPage,
  });

  const limit = readInt(query, 'limit', bag, {
    min: 1,
    max: config.pagination.maxLimit,
    fallback: config.pagination.defaultLimit,
  });

  return { page, limit };
}

module.exports = { parsePagination };
