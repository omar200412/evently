'use strict';

const bookingService = require('../services/bookingService');
const getRouteParam = require('../utils/getRouteParam');
const config = require('../config');

function list(req, res) {
  const { page, limit, eventId, status } = req.validated.query;
  res.status(200).json(bookingService.list({ page, limit, eventId, status }));
}

function getOne(req, res) {
  const id = getRouteParam(req, 'bookingId');
  res.status(200).json({ data: bookingService.getById(id) });
}

function create(req, res) {
  const { eventId, seats } = req.validated.body;

  const booking = bookingService.create({
    eventId,
    seats,
    userId: config.currentUserId,
  });

  res.status(201).json({ data: booking });
}

/**
 * DELETE, but a soft one. 200 with the cancelled record rather than 204: the
 * caller needs to see the resulting status, and there is still a resource to
 * return because nothing was actually removed.
 */
function cancel(req, res) {
  const id = getRouteParam(req, 'bookingId');
  const booking = bookingService.cancel(id);
  res.status(200).json({ data: booking });
}

module.exports = { list, getOne, create, cancel };
