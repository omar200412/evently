'use strict';

/**
 * The two halves of offset pagination, in one place.
 *
 * This used to slice an array, because the whole table lived in a Map. Against
 * Postgres the slicing is done by OFFSET/LIMIT, so what is left worth sharing is
 * the arithmetic and the response envelope — and those are worth sharing,
 * because three repositories build the same `{ data, page, limit, total }` and
 * an inconsistency between them would surface as one endpoint paginating
 * differently from the others.
 */

/** Turn a 1-based page into the skip/take a query needs. */
function pageParams({ page, limit }) {
  return { skip: (page - 1) * limit, take: limit };
}

/**
 * Build the list response.
 *
 * `total` must be the size of the *filtered* set, not the table: it is what the
 * client derives its page count from. Counting everything and paging a filtered
 * subset would hand out page numbers that return nothing.
 */
function pageResult({ data, total, page, limit }) {
  return { data, page, limit, total };
}

module.exports = { pageParams, pageResult };
