'use strict';

const ApiError = require('../utils/ApiError');

/**
 * Role gates — function-level authorization.
 *
 * This answers "may this kind of user call this endpoint at all", which is a
 * different question from "may this user touch this particular row". The second
 * one is ownership, and it cannot be answered by middleware because it needs the
 * row: it lives in the services, next to the fetch that loads it.
 *
 * Getting that split wrong is how APIs end up with a perfectly good role check
 * on `PATCH /events/:id` that still lets any organizer edit any organizer's
 * event.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    // Belt and braces: this should always follow `authenticate`, but a route
    // wired up in the wrong order must fail closed rather than read `undefined`
    // and wave the request through.
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(`This action requires the ${roles.join(' or ')} role`)
      );
    }

    return next();
  };
}

module.exports = { requireRole };
