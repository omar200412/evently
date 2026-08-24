'use strict';

const express = require('express');
const authController = require('../controllers/authController');
const { validateBody } = require('../middleware/validate');
const { authenticate } = require('../middleware/authenticate');
const asyncHandler = require('../utils/asyncHandler');
const { validateSignupBody, validateLoginBody } = require('../validators/authValidators');

const router = express.Router();

// Public by necessity — these are how a caller gets a credential in the first
// place. /refresh is public in the same sense: it is authenticated by the
// httpOnly cookie the browser attaches, not by a Bearer token, so requiring one
// would make it impossible to use after the access token expires, which is the
// only moment it exists for.
router.post('/signup', validateBody(validateSignupBody), asyncHandler(authController.signup));
router.post('/login', validateBody(validateLoginBody), asyncHandler(authController.login));
router.post('/refresh', asyncHandler(authController.refresh));
router.post('/logout', asyncHandler(authController.logout));

router.get('/me', authenticate, asyncHandler(authController.me));

module.exports = router;
