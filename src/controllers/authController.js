'use strict';

const authService = require('../services/authService');
const refreshToken = require('../auth/refreshToken');
const config = require('../config');

/**
 * Transport only, as ever. The one thing these handlers decide is where each
 * half of the session goes: the access token into the response body for the
 * client to hold in memory, the refresh token into an httpOnly cookie the
 * client cannot read at all.
 *
 * That split is the design. Script-readable storage for a week-long credential
 * is what turns any XSS into a persistent account takeover; a fifteen-minute
 * access token in memory is a much smaller prize.
 */

function sendSession(res, session, status) {
  res.cookie(config.auth.cookieName, session.refreshToken, refreshToken.cookieOptions());

  // Note what is absent: the refresh token is never in the body. Putting it in
  // both places would undo the httpOnly cookie entirely.
  res.status(status).json({
    data: { user: session.user, accessToken: session.accessToken },
  });
}

async function signup(req, res) {
  sendSession(res, await authService.signup(req.validated.body), 201);
}

async function login(req, res) {
  sendSession(res, await authService.login(req.validated.body), 200);
}

async function refresh(req, res) {
  const presented = req.cookies ? req.cookies[config.auth.cookieName] : undefined;
  sendSession(res, await authService.refresh(presented), 200);
}

async function logout(req, res) {
  const presented = req.cookies ? req.cookies[config.auth.cookieName] : undefined;

  await authService.logout(presented);

  // Cleared with the same attributes it was set with — a browser will not
  // remove a cookie whose path and flags do not match, and a logout that leaves
  // the cookie in place is a logout in name only.
  res.clearCookie(config.auth.cookieName, refreshToken.clearCookieOptions());
  res.status(204).end();
}

async function me(req, res) {
  res.status(200).json({ data: await authService.currentUser(req.user.sub) });
}

module.exports = { signup, login, refresh, logout, me };
