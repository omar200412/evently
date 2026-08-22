'use strict';

const eventService = require('../services/eventService');
const getRouteParam = require('../utils/getRouteParam');

/**
 * Controllers are transport-only: read the request, call a service, choose a
 * status code. No business rules and no store access live here, which is why
 * moving to a database later would not touch this file.
 */

function list(req, res) {
  const { page, limit, venueId, from, to } = req.validated.query;
  res.status(200).json(eventService.list({ page, limit, venueId, from, to }));
}

function getOne(req, res) {
  const id = getRouteParam(req, 'eventId');
  res.status(200).json({ data: eventService.getById(id) });
}

function create(req, res) {
  const event = eventService.create(req.validated.body);
  res.status(201).json({ data: event });
}

function update(req, res) {
  const id = getRouteParam(req, 'eventId');
  const event = eventService.update(id, req.validated.body);
  res.status(200).json({ data: event });
}

function remove(req, res) {
  const id = getRouteParam(req, 'eventId');
  const event = eventService.remove(id);
  res.status(200).json({ data: event });
}

module.exports = { list, getOne, create, update, remove };
