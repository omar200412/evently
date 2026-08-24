'use strict';

const venueRepository = require('../repositories/venueRepository');
const ApiError = require('../utils/ApiError');

function list({ page, limit }) {
  return venueRepository.listPaginated({ page, limit });
}

async function getById(id) {
  const venue = await venueRepository.findById(id);

  if (!venue) {
    throw ApiError.notFound(`Venue not found: ${id}`);
  }

  return venue;
}

module.exports = { list, getById };
