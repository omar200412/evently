'use strict';

const express = require('express');
const bookingController = require('../controllers/bookingController');
const { validateBody, validateQuery } = require('../middleware/validate');
const { validateUuidParam } = require('../middleware/validateParams');
const asyncHandler = require('../utils/asyncHandler');
const {
  validateCreateBookingBody,
  validateListBookingsQuery,
} = require('../validators/bookingValidators');

const router = express.Router();

router.get('/', validateQuery(validateListBookingsQuery), asyncHandler(bookingController.list));
router.post('/', validateBody(validateCreateBookingBody), asyncHandler(bookingController.create));
router.get('/:bookingId', validateUuidParam('bookingId'), asyncHandler(bookingController.getOne));
router.delete(
  '/:bookingId',
  validateUuidParam('bookingId'),
  asyncHandler(bookingController.cancel)
);

module.exports = router;
