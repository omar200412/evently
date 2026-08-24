'use strict';

const authRepository = require('../repositories/authRepository');
const password = require('../auth/password');
const jwt = require('../auth/jwt');
const refreshToken = require('../auth/refreshToken');
const { toPublicUser } = require('../auth/user.dto');
const ApiError = require('../utils/ApiError');
const { ROLE } = require('../domain');

/**
 * Signup, login, refresh, logout.
 *
 * Everything here returns `{ user, accessToken, refreshToken }` or throws an
 * ApiError. The controller's job is to put the refresh token in a cookie and
 * the rest in a body — it never decides anything.
 */

/**
 * Create an account.
 *
 * The role is hard-coded to ATTENDEE and is not read from the input at all.
 * Validating a client-supplied role would still be a mistake: the only safe
 * signup is one where privilege is not an input. Becoming an ORGANIZER is an
 * administrative act, done out of band.
 */
async function signup({ email, name, password: plaintext }) {
  const existing = await authRepository.findUserByEmail(email);

  if (existing) {
    // Deliberately vague, and a 409 either way. "That email is taken" is a
    // user-enumeration oracle: it confirms who has an account here to anyone who
    // can type an address. The trade-off is a slightly worse error for an honest
    // typo, which is the right side to err on.
    throw ApiError.conflict('Could not create that account');
  }

  const user = await authRepository.createUser({
    email,
    name,
    passwordHash: await password.hash(plaintext),
    role: ROLE.ATTENDEE,
  });

  return issueSession(user);
}

/**
 * Exchange credentials for a session.
 *
 * One error message for "no such user" and for "wrong password", and the
 * unknown-email path still pays for a hash comparison. Both halves are needed:
 * a different message leaks account existence directly, and an early return
 * leaks it through timing.
 */
async function login({ email, password: plaintext }) {
  const user = await authRepository.findUserByEmail(email);

  if (!user) {
    await password.fakeVerify();
    throw ApiError.unauthorized('Invalid email or password');
  }

  const matches = await password.verify(plaintext, user.passwordHash);

  if (!matches) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  return issueSession(user);
}

/**
 * Trade a refresh token for a new pair, and retire the old one.
 *
 * This is where theft is detected. A refresh token is single-use: presenting one
 * that has already been rotated means two parties hold it, and only one of them
 * came by it honestly. There is no way to tell which — so the entire family is
 * revoked and both are logged out. Whoever knows the password gets back in;
 * whoever only had the stolen token does not.
 *
 * Without that, rotation alone buys very little: a thief who refreshes once
 * simply holds a fresh valid token and the real user's next refresh fails, which
 * looks like a glitch rather than a break-in.
 */
async function refresh(presentedToken) {
  if (!presentedToken) {
    throw ApiError.unauthorized('Missing refresh token');
  }

  const stored = await authRepository.findRefreshToken(refreshToken.hash(presentedToken));

  // No row means the token was never issued here, or the user has been deleted.
  if (!stored) {
    throw ApiError.unauthorized('Invalid refresh token');
  }

  if (stored.revokedAt) {
    // Already rotated, and presented again. Assume compromise.
    await authRepository.revokeAllForUser(stored.userId);
    throw ApiError.unauthorized('Refresh token has been revoked');
  }

  if (stored.expiresAt <= new Date()) {
    throw ApiError.unauthorized('Refresh token has expired');
  }

  const token = refreshToken.generate();

  await authRepository.rotate({
    oldTokenId: stored.id,
    tokenHash: refreshToken.hash(token),
    userId: stored.userId,
    expiresAt: refreshToken.expiryFromNow(),
  });

  return {
    user: toPublicUser(stored.user),
    accessToken: jwt.sign({ userId: stored.user.id, role: stored.user.role }),
    refreshToken: token,
  };
}

/**
 * End the session.
 *
 * Revoking only the presented token, not the user's whole family — logging out
 * of a laptop should not sign you out of your phone. Unknown or already-revoked
 * tokens are not an error: logout has to be idempotent, and telling a caller
 * their token was not found is information they have no use for.
 */
async function logout(presentedToken) {
  if (!presentedToken) return;

  const stored = await authRepository.findRefreshToken(refreshToken.hash(presentedToken));

  if (stored && !stored.revokedAt) {
    await authRepository.revokeToken(stored.id);
  }
}

async function currentUser(userId) {
  const user = await authRepository.findUserById(userId);

  // The token verified, but its subject is gone — a deleted account holding a
  // still-valid access token. Not a 404: as far as the caller is concerned,
  // their credential no longer identifies anyone.
  if (!user) {
    throw ApiError.unauthorized('Account no longer exists');
  }

  return toPublicUser(user);
}

/** Mint a fresh pair for a user who has just proven who they are. */
async function issueSession(user) {
  const token = refreshToken.generate();

  await authRepository.createRefreshToken({
    tokenHash: refreshToken.hash(token),
    userId: user.id,
    expiresAt: refreshToken.expiryFromNow(),
  });

  return {
    user: toPublicUser(user),
    accessToken: jwt.sign({ userId: user.id, role: user.role }),
    refreshToken: token,
  };
}

module.exports = { signup, login, refresh, logout, currentUser };
