'use strict';

const venueService = require('../services/venueService');
const getRouteParam = require('../utils/getRouteParam');

function list(req, res) {
  const { page, limit } = req.validated.query;
  res.status(200).json(venueService.list({ page, limit }));
}

function getOne(req, res) {
  const id = getRouteParam(req, 'venueId');
  res.status(200).json({ data: venueService.getById(id) });
}

module.exports = { list, getOne };
