'use strict';

const ApiError = require('../utils/ApiError');

/** Anything that reaches here matched no route. */
function notFound(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

module.exports = notFound;
