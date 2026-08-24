'use strict';

const {
  ErrorBag,
  isPlainObject,
  rejectUnknownFields,
  readString,
} = require('../utils/validation');
const ApiError = require('../utils/ApiError');

// `role` is deliberately absent from both. A client that sends one gets a 400
// for an unknown field rather than being quietly ignored — if privilege
// escalation is attempted, the response should say so, not pretend it worked.
const SIGNUP_FIELDS = ['email', 'name', 'password'];
const LOGIN_FIELDS = ['email', 'password'];

// Long enough to be worth bcrypt's time. Length does far more for a password
// than a composition rule does: forcing a symbol mostly produces "Password1!",
// which is in every wordlist.
const MIN_PASSWORD_LENGTH = 12;

// bcrypt only reads the first 72 bytes of its input, so anything past that is
// not "extra security", it is silently ignored. Rejecting it is honest.
const MAX_PASSWORD_LENGTH = 72;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readEmail(body, bag) {
  const email = readString(body, 'email', bag, { required: true, max: 255 });

  if (email === undefined) return undefined;

  if (!EMAIL_PATTERN.test(email)) {
    bag.add('email', 'email must be a valid email address');
    return undefined;
  }

  // Stored lowercase so Omar@ and omar@ cannot become two accounts, which would
  // make the unique constraint decorative and "which one did I sign up with" a
  // support ticket.
  return email.toLowerCase();
}

function readPassword(body, bag) {
  const value = body.password;

  if (value === undefined || value === null || value === '') {
    bag.add('password', 'password is required');
    return undefined;
  }

  if (typeof value !== 'string') {
    bag.add('password', 'password must be a string');
    return undefined;
  }

  // Not trimmed. A password is an exact byte sequence; silently stripping
  // whitespace means a password that works on signup and fails on login, or the
  // reverse.
  if (value.length < MIN_PASSWORD_LENGTH) {
    bag.add('password', `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    return undefined;
  }

  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_LENGTH) {
    bag.add('password', `password must be at most ${MAX_PASSWORD_LENGTH} bytes`);
    return undefined;
  }

  return value;
}

function validateSignupBody(body) {
  if (!isPlainObject(body)) {
    throw ApiError.badRequest('Request body must be a JSON object');
  }

  const bag = new ErrorBag();

  rejectUnknownFields(body, SIGNUP_FIELDS, bag);

  const email = readEmail(body, bag);
  const name = readString(body, 'name', bag, { required: true, min: 2, max: 200 });
  const password = readPassword(body, bag);

  bag.throwIfAny('Invalid request body');

  return { email, name, password };
}

function validateLoginBody(body) {
  if (!isPlainObject(body)) {
    throw ApiError.badRequest('Request body must be a JSON object');
  }

  const bag = new ErrorBag();

  rejectUnknownFields(body, LOGIN_FIELDS, bag);

  const email = readString(body, 'email', bag, { required: true, max: 255 });
  const password = readString(body, 'password', bag, { required: true, max: 200 });

  // Login checks presence, not strength. Applying the signup rules here would
  // reject an old password that predates them — and reveal, from the shape of
  // the error, that the rules changed.
  bag.throwIfAny('Invalid request body');

  return { email: email && email.toLowerCase(), password };
}

module.exports = {
  validateSignupBody,
  validateLoginBody,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
};
