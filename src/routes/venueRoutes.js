'use strict';

const express = require('express');
const venueController = require('../controllers/venueController');
const { validateQuery } = require('../middleware/validate');
const { validateListVenuesQuery } = require('../validators/venueValidators');

const router = express.Router();

router.get('/', validateQuery(validateListVenuesQuery), venueController.list);
router.get('/:venueId', venueController.getOne);

module.exports = router;
