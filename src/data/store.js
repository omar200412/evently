'use strict';

/**
 * In-memory persistence.
 *
 * Everything here is a plain Map keyed by id. Only the service layer touches
 * this module — controllers never import it. That boundary is the whole point:
 * swapping this for a real database means rewriting this file and the service
 * queries, and nothing above them.
 */

const state = {
  venues: new Map(),
  events: new Map(),
  bookings: new Map(),
  counters: { venue: 0, event: 0, booking: 0 },
};

function nextId(kind, prefix) {
  state.counters[kind] += 1;
  return `${prefix}_${state.counters[kind]}`;
}

function seed() {
  state.venues.clear();
  state.events.clear();
  state.bookings.clear();
  state.counters = { venue: 0, event: 0, booking: 0 };

  const venues = [
    { name: 'The Grand Hall', city: 'Cairo', capacity: 500 },
    { name: 'Riverside Theatre', city: 'Alexandria', capacity: 220 },
    { name: 'Tech Park Auditorium', city: 'Cairo', capacity: 120 },
  ];

  const createdVenues = venues.map((venue) => {
    const id = nextId('venue', 'ven');
    const record = { id, ...venue };
    state.venues.set(id, record);
    return record;
  });

  const events = [
    { title: 'Node.js Deep Dive', venueId: createdVenues[2].id, startsAt: '2026-09-10T18:00:00.000Z', capacity: 80 },
    { title: 'Cairo Jazz Night', venueId: createdVenues[0].id, startsAt: '2026-09-15T20:00:00.000Z', capacity: 400 },
    { title: 'Startup Pitch Day', venueId: createdVenues[2].id, startsAt: '2026-10-01T09:00:00.000Z', capacity: 100 },
    { title: 'Shakespeare in the Park', venueId: createdVenues[1].id, startsAt: '2026-10-12T19:30:00.000Z', capacity: 200 },
    { title: 'Design Systems Workshop', venueId: createdVenues[2].id, startsAt: '2026-11-03T10:00:00.000Z', capacity: 40 },
    { title: 'New Year Gala', venueId: createdVenues[0].id, startsAt: '2026-12-31T21:00:00.000Z', capacity: 500 },
  ];

  events.forEach((event) => {
    const id = nextId('event', 'evt');
    state.events.set(id, {
      id,
      title: event.title,
      description: `${event.title} at Evently.`,
      venueId: event.venueId,
      startsAt: event.startsAt,
      capacity: event.capacity,
    });
  });
}

seed();

module.exports = {
  venues: state.venues,
  events: state.events,
  bookings: state.bookings,
  nextId,
  reset: seed,
};
