'use strict';

/**
 * Slice an already-filtered array into a page.
 *
 * Order matters: callers must filter BEFORE calling this. `total` is the size
 * of the list handed in, so paginating first and filtering after would report
 * a total that describes the wrong set and break the client's page count.
 */
function paginate(items, { page, limit }) {
  const start = (page - 1) * limit;

  return {
    data: items.slice(start, start + limit),
    page,
    limit,
    total: items.length,
  };
}

module.exports = paginate;
