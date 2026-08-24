'use strict';

const { prisma } = require('../db/prisma');
const { pageParams, pageResult } = require('../utils/paginate');

/**
 * Data access for events.
 *
 * Filtering and paging both moved into SQL here. In the in-memory version the
 * service loaded every event and sliced the array; against a real table that
 * reads the whole thing into the process to hand back ten rows. The WHERE and
 * the LIMIT now run where the data is, and the (venue_id, starts_at) index in
 * the schema is what makes the filtered ordering cheap.
 */

function buildWhere({ venueId, from, to }) {
  const where = {};

  if (venueId) where.venueId = venueId;

  // Prisma drops an empty object, so only build startsAt when a bound exists —
  // otherwise `startsAt: {}` would be sent for every unfiltered list.
  if (from || to) {
    where.startsAt = {
      ...(from && { gte: from }),
      ...(to && { lte: to }),
    };
  }

  return where;
}

async function listPaginated({ page, limit, venueId, from, to }) {
  const where = buildWhere({ venueId, from, to });
  const { skip, take } = pageParams({ page, limit });

  // `total` must describe the filtered set, because that is what the client is
  // paging through — so the count carries the same WHERE as the page query.
  const [data, total] = await Promise.all([
    prisma.event.findMany({ where, orderBy: { startsAt: 'asc' }, skip, take }),
    prisma.event.count({ where }),
  ]);

  return pageResult({ data, total, page, limit });
}

function findById(id) {
  return prisma.event.findUnique({ where: { id } });
}

function create({ title, description, venueId, startsAt, capacity, organizerId }) {
  return prisma.event.create({
    data: { title, description: description ?? '', venueId, startsAt, capacity, organizerId },
  });
}

function update(id, changes) {
  return prisma.event.update({ where: { id }, data: changes });
}

/**
 * Hard delete. The bookings that pointed at the event go with it, by the
 * cascade declared in the schema — a booking for an event that no longer exists
 * is not history worth keeping, it is a dangling row.
 */
function remove(id) {
  return prisma.event.delete({ where: { id } });
}

module.exports = { listPaginated, findById, create, update, remove };
