'use strict';

const express = require('express');
const config = require('./config');
const routes = require('./routes');
const currentUser = require('./middleware/currentUser');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(express.json());

// Runs before the routes so every handler can read req.userId without knowing
// where identity came from.
app.use(currentUser);

app.use(config.apiPrefix, routes);

// Order matters: unmatched routes become a 404 ApiError, and the error handler
// is registered last so every failure in the stack above funnels through it.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
