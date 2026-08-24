'use strict';

const ApiError = require('../utils/ApiError');
const isUuid = require('../utils/isUuid');

/**
 * Reject route parameters that are not UUIDs before they reach a query.
 *
 * Primary keys became UUIDs when the store became Postgres, and a uuid column
 * cannot be compared against arbitrary text: `WHERE id = 'evt_1'` is not a miss,
 * it is a type error the driver raises, which the error handler would have to
 * report as a 500. A malformed id is the client's mistake, so it gets a 400
 * naming the parameter.
 *
 * "Well-formed but absent" stays a 404 — that is a real lookup that found
 * nothing, and the two cases mean different things to whoever is calling.
 */
function validateUuidParam(name) {
  return (req, res, next) => {
    const value = req.params ? req.params[name] : undefined;

    if (!isUuid(value)) {
      return next(
        ApiError.badRequest(`Invalid route parameter: ${name}`, [
          { field: name, message: `${name} must be a UUID` },
        ])
      );
    }

    return next();
  };
}

module.exports = { validateUuidParam };
