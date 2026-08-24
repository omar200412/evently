'use strict';

// Prisma 7 stopped reading .env on its own, stopped taking the connection URL
// from the schema, and stopped inferring the seed command from package.json.
// All three now live here, which is why this file exists at all.
require('dotenv').config({ quiet: true });

const path = require('node:path');
const { defineConfig } = require('prisma/config');

module.exports = defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  // Used by the CLI (migrate, db push, studio) only. The running application
  // never reads this — it connects through the driver adapter in src/db/prisma.js.
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    path: path.join(__dirname, 'prisma', 'migrations'),
    seed: 'node prisma/seed.js',
  },
});
