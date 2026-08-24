'use strict';

const express = require('express');
const venueController = require('../controllers/venueController');
const { validateQuery } = require('../middleware/validate');
const { validateUuidParam } = require('../middleware/validateParams');
const asyncHandler = require('../utils/asyncHandler');
const { validateListVenuesQuery } = require('../validators/venueValidators');

const router = express.Router();

router.get('/', validateQuery(validateListVenuesQuery), asyncHandler(venueController.list));
router.get('/:venueId', validateUuidParam('venueId'), asyncHandler(venueController.getOne));

module.exports = router;
