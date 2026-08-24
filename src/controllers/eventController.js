'use strict';

const eventService = require('../services/eventService');
const getRouteParam = require('../utils/getRouteParam');

/**
 * Controllers are transport-only: read the request, call a service, choose a
 * status code. No business rules and no database access live here — which is
 * what kept this file to an `await` per handler when the store became Postgres.
 */

async function list(req, res) {
  const { page, limit, venueId, from, to } = req.validated.query;
  res.status(200).json(await eventService.list({ page, limit, venueId, from, to }));
}

async function getOne(req, res) {
  const id = getRouteParam(req, 'eventId');
  res.status(200).json({ data: await eventService.getById(id) });
}

async function create(req, res) {
  const event = await eventService.create(req.validated.body);
  res.status(201).json({ data: event });
}

async function update(req, res) {
  const id = getRouteParam(req, 'eventId');
  const event = await eventService.update(id, req.validated.body);
  res.status(200).json({ data: event });
}

async function remove(req, res) {
  const id = getRouteParam(req, 'eventId');
  const event = await eventService.remove(id);
  res.status(200).json({ data: event });
}

module.exports = { list, getOne, create, update, remove };
