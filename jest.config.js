'use strict';

module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.js',
  // One database, shared state, TRUNCATE between cases: parallel workers would
  // wipe each other's rows mid-test.
  maxWorkers: 1,
  testTimeout: 30000,
};
