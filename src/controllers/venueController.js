'use strict';

const venueService = require('../services/venueService');
const getRouteParam = require('../utils/getRouteParam');

async function list(req, res) {
  const { page, limit } = req.validated.query;
  res.status(200).json(await venueService.list({ page, limit }));
}

async function getOne(req, res) {
  const id = getRouteParam(req, 'venueId');
  res.status(200).json({ data: await venueService.getById(id) });
}

module.exports = { list, getOne };
