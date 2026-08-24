'use strict';

const config = require('../config');
const isUuid = require('../utils/isUuid');

/**
 * Stand-in for authentication.
 *
 * There is still no auth in this project, and every request is still treated as
 * coming from one configured user. What changed is where handlers read that
 * from: `req.userId`, set here, instead of reaching into config themselves.
 * That is the seam real auth slots into — this middleware becomes token
 * verification, and no controller changes.
 *
 * Outside production it also honours an `x-user-id` header. That is what lets
 * the concurrency proof send twenty simultaneous bookings as twenty different
 * people over real HTTP rather than calling the service layer directly and
 * skipping the stack it is meant to exercise.
 *
 * The production guard is not decoration. Without it this header is complete
 * account takeover: anyone could book, and cancel, as anyone.
 */
function currentUser(req, res, next) {
  req.userId = config.currentUserId;

  if (config.env !== 'production') {
    const header = req.get('x-user-id');
    if (isUuid(header)) req.userId = header;
  }

  next();
}

module.exports = currentUser;
