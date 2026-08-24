'use strict';

module.exports = async function globalTeardown() {
  const server = globalThis.__EVENTLY_PG__;
  if (server) await server.stop();
};
