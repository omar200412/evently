'use strict';

const ApiError = require('./ApiError');
const isUuid = require('./isUuid');

/**
 * Collects every problem with an input before throwing, so the client gets
 * one response listing all of them instead of discovering them one request
 * at a time.
 */
class ErrorBag {
  constructor() {
    this.errors = [];
  }

  add(field, message) {
    this.errors.push({ field, message });
  }

  get isEmpty() {
    return this.errors.length === 0;
  }

  throwIfAny(message) {
    if (!this.isEmpty) {
      throw ApiError.badRequest(message, this.errors);
    }
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reject any field we did not explicitly allow.
 *
 * Silently dropping unknown fields is worse than refusing them: a client that
 * misspells `capacity` as `capcity` would get a 201 and quietly wrong data.
 */
function rejectUnknownFields(input, allowed, bag) {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      bag.add(key, `Unknown field: ${key}`);
    }
  }
}

function readString(input, name, bag, { required = false, min = 1, max = 500 } = {}) {
  const value = input[name];

  if (value === undefined || value === null) {
    if (required) bag.add(name, `${name} is required`);
    return undefined;
  }

  if (typeof value !== 'string') {
    bag.add(name, `${name} must be a string`);
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length < min) {
    bag.add(name, `${name} must be at least ${min} character(s)`);
    return undefined;
  }

  if (trimmed.length > max) {
    bag.add(name, `${name} must be at most ${max} characters`);
    return undefined;
  }

  return trimmed;
}

function readInt(input, name, bag, { required = false, min, max, fallback } = {}) {
  const value = input[name];

  if (value === undefined || value === null || value === '') {
    if (required) bag.add(name, `${name} is required`);
    return fallback;
  }

  // Query strings arrive as text, JSON bodies as numbers. Accept both, but
  // reject anything that is not a clean whole number ("3abc", "1.5", true).
  const asNumber = typeof value === 'number' ? value : Number(String(value).trim());

  if (!Number.isInteger(asNumber)) {
    bag.add(name, `${name} must be an integer`);
    return undefined;
  }

  if (min !== undefined && asNumber < min) {
    bag.add(name, `${name} must be >= ${min}`);
    return undefined;
  }

  if (max !== undefined && asNumber > max) {
    bag.add(name, `${name} must be <= ${max}`);
    return undefined;
  }

  return asNumber;
}

/**
 * Read a value that has to be a UUID.
 *
 * Ids became UUIDs when the store became Postgres, and a uuid column cannot be
 * compared against arbitrary text — the driver raises a type error rather than
 * returning no rows. Catching the shape here turns what would surface as a 500
 * into a 400 naming the field.
 */
function readUuid(input, name, bag, { required = false } = {}) {
  const value = input[name];

  if (value === undefined || value === null || value === '') {
    if (required) bag.add(name, `${name} is required`);
    return undefined;
  }

  if (typeof value !== 'string') {
    bag.add(name, `${name} must be a string`);
    return undefined;
  }

  const trimmed = value.trim();

  if (!isUuid(trimmed)) {
    bag.add(name, `${name} must be a UUID`);
    return undefined;
  }

  return trimmed;
}

function readIsoDate(input, name, bag, { required = false } = {}) {
  const value = input[name];

  if (value === undefined || value === null || value === '') {
    if (required) bag.add(name, `${name} is required`);
    return undefined;
  }

  if (typeof value !== 'string') {
    bag.add(name, `${name} must be an ISO 8601 date string`);
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    bag.add(name, `${name} must be a valid ISO 8601 date string`);
    return undefined;
  }

  return parsed;
}

module.exports = {
  ErrorBag,
  isPlainObject,
  rejectUnknownFields,
  readString,
  readInt,
  readUuid,
  readIsoDate,
};
