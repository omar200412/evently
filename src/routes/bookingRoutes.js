'use strict';

const express = require('express');
const bookingController = require('../controllers/bookingController');
const { validateBody, validateQuery } = require('../middleware/validate');
const { validateUuidParam } = require('../middleware/validateParams');
const { authenticate } = require('../middleware/authenticate');
const asyncHandler = require('../utils/asyncHandler');
const {
  validateCreateBookingBody,
  validateListBookingsQuery,
} = require('../validators/bookingValidators');

const router = express.Router();

// Every booking route is authenticated, and none of them takes a role: booking
// is what an ordinary account is for. What separates users here is ownership,
// not privilege — enforced in bookingService, where the row is in hand.
router.use(authenticate);

router.get('/', validateQuery(validateListBookingsQuery), asyncHandler(bookingController.list));
router.post('/', validateBody(validateCreateBookingBody), asyncHandler(bookingController.create));
router.get('/:bookingId', validateUuidParam('bookingId'), asyncHandler(bookingController.getOne));
router.delete(
  '/:bookingId',
  validateUuidParam('bookingId'),
  asyncHandler(bookingController.cancel)
);

module.exports = router;
