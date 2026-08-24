'use strict';

const express = require('express');
const eventRoutes = require('./eventRoutes');
const venueRoutes = require('./venueRoutes');
const bookingRoutes = require('./bookingRoutes');
const asyncHandler = require('../utils/asyncHandler');
const { prisma } = require('../db/prisma');

const router = express.Router();

/**
 * Liveness check.
 *
 * It queries the database on purpose. An API that reports "ok" while its only
 * datastore is unreachable is worse than no health check at all — every
 * endpoint that matters would be failing while the orchestrator kept routing
 * traffic to it.
 */
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ status: 'ok', database: 'up' });
    } catch (error) {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  })
);

router.use('/events', eventRoutes);
router.use('/venues', venueRoutes);
router.use('/bookings', bookingRoutes);

module.exports = router;
