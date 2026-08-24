'use strict';

/**
 * An error that carries the HTTP status the client should see.
 *
 * Anything thrown that is NOT an ApiError is treated as a bug by the error
 * handler and becomes a 500. That is the rule that keeps 500s honest: they
 * mean "we broke", never "you sent something we didn't like".
 */
class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }

  /** No usable credential. The client may retry with one. */
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message);
  }

  /**
   * A valid credential that is not allowed to do this. 403, not 401 — retrying
   * with the same token will never help, and telling the client to authenticate
   * again when it already has would send it round a loop.
   */
  static forbidden(message = 'Not allowed') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static conflict(message, details) {
    return new ApiError(409, message, details);
  }

  static unprocessable(message, details) {
    return new ApiError(422, message, details);
  }
}

module.exports = ApiError;
