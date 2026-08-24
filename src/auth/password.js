'use strict';

const bcrypt = require('bcryptjs');
const config = require('../config');

/**
 * Password hashing.
 *
 * bcrypt, not SHA-256 or anything else fast. A general-purpose hash is designed
 * to be quick, which is precisely wrong here: it lets an attacker with the
 * table try billions of candidates a second. bcrypt is deliberately slow and
 * its cost is tunable, so the work factor can rise with hardware.
 *
 * The salt is generated per password and stored inside the hash string, so two
 * users with the same password get different hashes and a precomputed table is
 * worthless.
 */

function hash(plaintext) {
  return bcrypt.hash(plaintext, config.auth.bcryptRounds);
}

/**
 * Check a password against a stored hash.
 *
 * bcrypt.compare is a constant-time comparison of the hashes. Comparing with
 * `===` would leak how many leading bytes matched through timing, which is
 * enough to reconstruct a hash byte by byte.
 */
function verify(plaintext, storedHash) {
  return bcrypt.compare(plaintext, storedHash);
}

/**
 * Burn roughly the same time as a real verification, and fail.
 *
 * Login for an unknown email must not return faster than login for a known one.
 * If it does, the difference is a user-enumeration oracle: an attacker learns
 * which addresses have accounts by timing the response, without ever guessing a
 * password. So the unknown-email path hashes a throwaway value instead of
 * returning early.
 */
async function fakeVerify() {
  await bcrypt.compare('not-a-real-password', DUMMY_HASH);
  return false;
}

// Precomputed at module load so the fake path costs a comparison, not a hash.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.auth.bcryptRounds);

module.exports = { hash, verify, fakeVerify };
