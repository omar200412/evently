'use strict';

const ApiError = require('../utils/ApiError');

/**
 * The only place in the application allowed to produce a 500.
 *
 * Known failures arrive as ApiError and keep their own status. Anything else
 * is an unhandled bug: it is logged in full and reported to the client as a
 * generic 500, so internals never leak out in a response body.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
function errorHandler(error, req, res, next) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: {
        message: error.message,
        ...(error.details && { details: error.details }),
      },
    });
  }

  // Malformed JSON is thrown by express.json() before any of our code runs.
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { message: 'Request body is not valid JSON' },
    });
  }

  console.error('Unhandled error:', error);

  return res.status(500).json({
    error: { message: 'Internal server error' },
  });
}

module.exports = errorHandler;
