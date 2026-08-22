'use strict';

const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`Evently API listening on http://localhost:${config.port}${config.apiPrefix}`);
});
