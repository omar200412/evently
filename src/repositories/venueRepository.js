'use strict';

const { prisma } = require('../db/prisma');
const { pageParams, pageResult } = require('../utils/paginate');

/**
 * Data access for venues.
 *
 * Repositories are the only modules that import the Prisma client, the same way
 * only services used to import the in-memory store. They return plain rows and
 * throw nothing of their own: an empty result is `null`, and turning that into
 * a 404 is the service's job.
 */

async function listPaginated({ page, limit }) {
  const { skip, take } = pageParams({ page, limit });

  // Count and page in one round trip. Two awaits in sequence would double the
  // latency of every list request for no benefit — neither query needs the other.
  const [data, total] = await Promise.all([
    prisma.venue.findMany({ orderBy: { name: 'asc' }, skip, take }),
    prisma.venue.count(),
  ]);

  return pageResult({ data, total, page, limit });
}

function findById(id) {
  return prisma.venue.findUnique({ where: { id } });
}

/** Existence check that does not load the row — used when validating an event's venueId. */
async function exists(id) {
  const found = await prisma.venue.findUnique({ where: { id }, select: { id: true } });
  return found !== null;
}

module.exports = { listPaginated, findById, exists };
