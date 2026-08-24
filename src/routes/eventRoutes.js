'use strict';

const express = require('express');
const eventController = require('../controllers/eventController');
const { validateBody, validateQuery } = require('../middleware/validate');
const { validateUuidParam } = require('../middleware/validateParams');
const asyncHandler = require('../utils/asyncHandler');
const {
  validateListEventsQuery,
  validateCreateEventBody,
  validateUpdateEventBody,
} = require('../validators/eventValidators');

const router = express.Router();

// Nothing invalid gets past this layer: the query/body validators check the
// payload, validateUuidParam checks the id in the path, and asyncHandler makes
// sure a rejected promise from the controller lands on the error handler
// instead of hanging the request.
router.get('/', validateQuery(validateListEventsQuery), asyncHandler(eventController.list));
router.post('/', validateBody(validateCreateEventBody), asyncHandler(eventController.create));
router.get('/:eventId', validateUuidParam('eventId'), asyncHandler(eventController.getOne));
router.patch(
  '/:eventId',
  validateUuidParam('eventId'),
  validateBody(validateUpdateEventBody),
  asyncHandler(eventController.update)
);
router.delete('/:eventId', validateUuidParam('eventId'), asyncHandler(eventController.remove));

module.exports = router;
