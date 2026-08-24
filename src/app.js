'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const config = require('./config');
const routes = require('./routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

/**
 * CORS against an explicit allowlist.
 *
 * Not `origin: true`, which reflects whatever Origin arrives and is
 * indistinguishable from allowing everyone — except that it looks like a
 * configuration. With `credentials: true` that combination is the dangerous
 * one: any site could make authenticated requests with the user's refresh
 * cookie attached. The browser refuses `*` alongside credentials for exactly
 * this reason, and reflecting the origin is how people get around that refusal
 * without realising what they have done.
 */
app.use(
  cors({
    origin: config.cors.origins,
    credentials: true,
  })
);

// A body limit, because the default is 100kb but saying so makes it a decision.
// Unbounded JSON parsing is a denial-of-service primitive: one request can make
// the process allocate until it dies.
app.use(express.json({ limit: '100kb' }));

// Required for the refresh flow — the token lives in an httpOnly cookie, which
// means the server has to be the one reading it.
app.use(cookieParser());

// No global authentication middleware. Access is declared route by route in
// routes/, so a new endpoint is unprotected only if someone wrote it that way,
// not because it silently missed a list somewhere else in the file tree.
app.use(config.apiPrefix, routes);

// Order matters: unmatched routes become a 404 ApiError, and the error handler
// is registered last so every failure in the stack above funnels through it.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
