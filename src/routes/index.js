'use strict';

const express = require('express');
const eventRoutes = require('./eventRoutes');
const venueRoutes = require('./venueRoutes');
const bookingRoutes = require('./bookingRoutes');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.use('/events', eventRoutes);
router.use('/venues', venueRoutes);
router.use('/bookings', bookingRoutes);

module.exports = router;
