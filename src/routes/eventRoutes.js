'use strict';

const express = require('express');
const eventController = require('../controllers/eventController');
const { validateBody, validateQuery } = require('../middleware/validate');
const { validateUuidParam } = require('../middleware/validateParams');
const { authenticate } = require('../middleware/authenticate');
const { requireRole } = require('../middleware/authorize');
const asyncHandler = require('../utils/asyncHandler');
const { ROLE } = require('../domain');
const {
  validateListEventsQuery,
  validateCreateEventBody,
  validateUpdateEventBody,
} = require('../validators/eventValidators');

const router = express.Router();

// Reading events is public: this is a discovery surface, and requiring a login
// to see what is on would make the catalogue useless to anyone deciding whether
// to sign up.
router.get('/', validateQuery(validateListEventsQuery), asyncHandler(eventController.list));
router.get('/:eventId', validateUuidParam('eventId'), asyncHandler(eventController.getOne));

// Writing is not. Two gates, and they answer different questions: requireRole
// asks "may an ATTENDEE ever do this" (no), while the ownership check inside
// eventService asks "is this your event" — which middleware cannot answer,
// because it needs the row.
router.post(
  '/',
  authenticate,
  requireRole(ROLE.ORGANIZER),
  validateBody(validateCreateEventBody),
  asyncHandler(eventController.create)
);

router.patch(
  '/:eventId',
  authenticate,
  requireRole(ROLE.ORGANIZER),
  validateUuidParam('eventId'),
  validateBody(validateUpdateEventBody),
  asyncHandler(eventController.update)
);

router.delete(
  '/:eventId',
  authenticate,
  requireRole(ROLE.ORGANIZER),
  validateUuidParam('eventId'),
  asyncHandler(eventController.remove)
);

module.exports = router;
