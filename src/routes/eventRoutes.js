'use strict';

const express = require('express');
const eventController = require('../controllers/eventController');
const { validateBody, validateQuery } = require('../middleware/validate');
const {
  validateListEventsQuery,
  validateCreateEventBody,
  validateUpdateEventBody,
} = require('../validators/eventValidators');

const router = express.Router();

router.get('/', validateQuery(validateListEventsQuery), eventController.list);
router.post('/', validateBody(validateCreateEventBody), eventController.create);
router.get('/:eventId', eventController.getOne);
router.patch('/:eventId', validateBody(validateUpdateEventBody), eventController.update);
router.delete('/:eventId', eventController.remove);

module.exports = router;
