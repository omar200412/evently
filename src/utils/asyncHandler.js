'use strict';

/**
 * Wrap an async route handler so a rejected promise reaches the error handler.
 *
 * Express 4 has no idea what a promise is. It catches what a handler *throws*
 * synchronously; an async function does not throw, it returns a rejected
 * promise, which Express ignores. Without this wrapper, a database error in a
 * controller produces an unhandled rejection and a request that hangs until the
 * client times out — no 500, no log line, nothing.
 *
 * That is why every controller in this codebase goes through here now that the
 * service layer awaits Postgres.
 */
function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = asyncHandler;
