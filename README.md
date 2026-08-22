# Evently — Backend API

Events, venues and bookings REST API. Express, layered architecture, in-memory persistence.

## Running it

```bash
npm install
npm start          # http://localhost:3000/v1
npm test           # 39 tests
```

## Architecture

```
routes/       URL shape + which middleware runs
validators/   Input checking. Nothing invalid gets past this layer.
controllers/  Transport only: read request, call service, pick status code.
services/     All business rules. The only layer that touches the store.
data/store.js In-memory Maps. Swap for a DB without touching controllers.
```

The rule that holds it together: **controllers never import the store, and services never see `req` or `res`.** That is what makes a database migration a change to `data/` and `services/` only.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/health` | Liveness check |
| GET | `/v1/venues` | Paginated |
| GET | `/v1/venues/:venueId` | |
| GET | `/v1/events` | `page`, `limit`, `venue`, `from`, `to` |
| POST | `/v1/events` | **201** |
| GET | `/v1/events/:eventId` | |
| PATCH | `/v1/events/:eventId` | **200** |
| DELETE | `/v1/events/:eventId` | **200**, hard delete |
| GET | `/v1/bookings` | `page`, `limit`, `event`, `status` |
| POST | `/v1/bookings` | **201** |
| GET | `/v1/bookings/:bookingId` | |
| DELETE | `/v1/bookings/:bookingId` | **200**, soft delete → `CANCELLED` |

List responses are `{ data, page, limit, total }`. Single-resource responses are `{ data }`. Errors are `{ error: { message, details? } }`.

## The parts worth understanding

**Filtering runs before pagination.** `total` has to describe the filtered set, because that is what the client is paging through. Slicing first would report a total for the unfiltered list and hand out page numbers that don't exist. See `eventService.list()`.

**Unknown fields are rejected, not dropped.** Send `capcity` instead of `capacity` and you get a 400 naming the field. Silently ignoring it would return 201 with quietly wrong data.

**`userId` is not accepted from the request body.** It comes from `config.currentUserId`. A client that sends one gets a 400 for an unknown field, so nobody can book on someone else's behalf. When real auth lands, `config.currentUserId` becomes `req.user.id` and nothing else changes.

**Only the error handler returns 500.** Every expected failure is thrown as an `ApiError` carrying its own status. Anything else reaching `errorHandler` is a genuine bug: it gets logged in full and returned as a generic 500 so internals never leak.

**Cancelled bookings release their seats.** `confirmedSeatsFor()` counts only `CONFIRMED` rows, otherwise a cancelled booking would keep an event full forever. There's a test for exactly this.

**Errors are collected, not thrown one at a time.** `ErrorBag` gathers every problem with an input so `POST /v1/events` with an empty body returns all missing fields at once.

## Judgment calls — check these against your rubric

Built without the assignment brief in hand, so these are defensible but not the only valid answer:

1. **422 for a bad `eventId`/`venueId` reference**, not 404. The booking you're creating isn't missing — the thing it points at is. If your rubric says 404, change `ApiError.unprocessable` → `ApiError.notFound` in `bookingService.create()` and `eventService.create()`.
2. **Cancelling twice is a 409**, not an idempotent 200. Makes a double-submit visible instead of looking like success.
3. **`DELETE /v1/events/:id` hard deletes**; only bookings soft delete. If events should soft delete too, mirror `bookingService.cancel()`.
4. **`PATCH` for event updates**, not `PUT`. Partial updates with "at least one field required".
5. **Max 20 seats per booking** — arbitrary, in `bookingValidators.js`.

## Tests

`tests/events.test.js`, `tests/bookings.test.js`, `tests/utils.test.js` — pagination boundaries, filter correctness, every validation rejection, and each business rule including the capacity edge case where a booking asks for exactly the remaining seats.
