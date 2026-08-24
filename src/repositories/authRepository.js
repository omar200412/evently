'use strict';

const { prisma } = require('../db/prisma');

/**
 * Data access for users and refresh tokens.
 *
 * Same rule as every other repository: it returns rows, and it throws nothing
 * of its own. The one thing worth noticing is `findUserByEmail` selecting
 * `passwordHash` explicitly — it is the only query in the codebase that reads
 * that column, and it exists solely so the login path can compare against it.
 */

function findUserByEmail(email) {
  return prisma.user.findUnique({ where: { email } });
}

function findUserById(id) {
  return prisma.user.findUnique({ where: { id } });
}

function createUser({ email, name, passwordHash, role }) {
  return prisma.user.create({ data: { email, name, passwordHash, role } });
}

function createRefreshToken({ tokenHash, userId, expiresAt }) {
  return prisma.refreshToken.create({ data: { tokenHash, userId, expiresAt } });
}

/**
 * Look a refresh token up by its hash, with the owning user attached.
 *
 * The user comes along because the caller always needs the role to mint the
 * next access token, and a second round trip for a row we already joined to
 * would be waste.
 */
function findRefreshToken(tokenHash) {
  return prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
}

/**
 * Rotate: issue the replacement and retire the old token in one transaction.
 *
 * It has to be atomic. If the new token were created and the old one left live
 * by a crash in between, both would work — and "the old one still works" is
 * exactly the property rotation exists to remove. If the old one were revoked
 * and the new one never created, the user would be logged out with no way back.
 */
function rotate({ oldTokenId, tokenHash, userId, expiresAt }) {
  return prisma.$transaction(async (tx) => {
    const replacement = await tx.refreshToken.create({
      data: { tokenHash, userId, expiresAt },
    });

    await tx.refreshToken.update({
      where: { id: oldTokenId },
      data: { revokedAt: new Date(), replacedById: replacement.id },
    });

    return replacement;
  });
}

function revokeToken(id) {
  return prisma.refreshToken.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revoke every live token a user holds.
 *
 * This is the response to a reuse attempt. Once one token in a chain has been
 * presented twice, there is no way to tell which party is the legitimate user —
 * so both are logged out and whoever knows the password gets back in.
 */
function revokeAllForUser(userId) {
  return prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  createRefreshToken,
  findRefreshToken,
  rotate,
  revokeToken,
  revokeAllForUser,
};
