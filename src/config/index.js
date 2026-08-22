'use strict';

/**
 * Application configuration.
 *
 * CURRENT_USER_ID stands in for authentication. There is no auth in this
 * session, so every request is treated as coming from this user. When auth
 * lands, this is replaced by req.user.id and nothing else has to change.
 */
module.exports = {
  port: Number(process.env.PORT) || 3000,
  apiPrefix: '/v1',
  currentUserId: 'usr_1',
  pagination: {
    defaultPage: 1,
    defaultLimit: 10,
    maxLimit: 100,
  },
};
