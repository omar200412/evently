'use strict';

const bookingService = require('../services/bookingService');
const getRouteParam = require('../utils/getRouteParam');

async function list(req, res) {
  const { page, limit, eventId, status } = req.validated.query;

  res.status(200).json(
    await bookingService.list({ page, limit, eventId, status, userId: req.user.sub })
  );
}

async function getOne(req, res) {
  const id = getRouteParam(req, 'bookingId');
  res.status(200).json({ data: await bookingService.getById(id, req.user.sub) });
}

async function create(req, res) {
  const { eventId, seats } = req.validated.body;

  const booking = await bookingService.create({
    eventId,
    seats,
    // From the verified access token. The validators reject a userId in the
    // body, so there is no path by which a client supplies this.
    userId: req.user.sub,
  });

  res.status(201).json({ data: booking });
}

/**
 * DELETE, but a soft one. 200 with the cancelled record rather than 204: the
 * caller needs to see the resulting status, and there is still a resource to
 * return because nothing was actually removed.
 */
async function cancel(req, res) {
  const id = getRouteParam(req, 'bookingId');
  const booking = await bookingService.cancel(id, req.user.sub);
  res.status(200).json({ data: booking });
}

module.exports = { list, getOne, create, cancel };
