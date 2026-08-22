'use strict';

const express = require('express');
const bookingController = require('../controllers/bookingController');
const { validateBody, validateQuery } = require('../middleware/validate');
const {
  validateCreateBookingBody,
  validateListBookingsQuery,
} = require('../validators/bookingValidators');

const router = express.Router();

router.get('/', validateQuery(validateListBookingsQuery), bookingController.list);
router.post('/', validateBody(validateCreateBookingBody), bookingController.create);
router.get('/:bookingId', bookingController.getOne);
router.delete('/:bookingId', bookingController.cancel);

module.exports = router;
