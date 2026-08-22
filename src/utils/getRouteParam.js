'use strict';

const ApiError = require('./ApiError');

/**
 * Read a route parameter and fail loudly if it is missing or blank.
 *
 * Controllers used to each re-check req.params by hand, which is how you end
 * up passing undefined into a service and getting a confusing 500 three
 * layers down. Reading params through here turns that into a clean 400.
 */
function getRouteParam(req, name) {
  const raw = req.params ? req.params[name] : undefined;

  if (typeof raw !== 'string' || raw.trim() === '') {
    throw ApiError.badRequest(`Missing route parameter: ${name}`);
  }

  return raw.trim();
}

module.exports = getRouteParam;
