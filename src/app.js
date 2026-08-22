'use strict';

const express = require('express');
const config = require('./config');
const routes = require('./routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(express.json());

app.use(config.apiPrefix, routes);

// Order matters: unmatched routes become a 404 ApiError, and the error handler
// is registered last so every failure in the stack above funnels through it.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
