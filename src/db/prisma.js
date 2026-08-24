'use strict';

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const config = require('../config');

/**
 * The one PrismaClient for the process.
 *
 * Prisma 7 connects through a driver adapter rather than its own engine, so the
 * `pg` pool below is the actual connection pool. One client per process is not
 * a style preference: each new PrismaClient opens its own pool, and a handful
 * of stray instances will exhaust Postgres's connection limit long before the
 * application is under any real load.
 */

const adapter = new PrismaPg({
  connectionString: config.databaseUrl,
  // Serializable transactions hold a connection for their whole run and retry
  // on conflict, so the pool has to be wider than the peak number of concurrent
  // bookings or the retries queue behind the attempts they are retrying.
  max: 20,
});

// Silent under test: several cases deliberately trigger constraint violations
// and serialization failures, and logging each one buries the actual results.
function logLevels() {
  if (config.env === 'test' || config.db.silent) return [];
  return config.env === 'development' ? ['warn', 'error'] : ['error'];
}

const prisma = new PrismaClient({ adapter, log: logLevels() });

async function disconnect() {
  await prisma.$disconnect();
}

module.exports = { prisma, disconnect };
