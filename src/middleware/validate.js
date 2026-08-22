'use strict';

/**
 * Turn a validator function into middleware.
 *
 * Validated output lands on req.validated rather than overwriting req.body or
 * req.query, so a controller reading req.validated is guaranteed to be looking
 * at checked, coerced data and never the raw input.
 */
function validate(validator, source) {
  return (req, res, next) => {
    try {
      req.validated = req.validated || {};
      req.validated[source] = validator(req[source]);
      next();
    } catch (error) {
      next(error);
    }
  };
}

const validateBody = (validator) => validate(validator, 'body');
const validateQuery = (validator) => validate(validator, 'query');

module.exports = { validate, validateBody, validateQuery };
