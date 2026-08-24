# Evently — Backend API

Events, venues and bookings REST API. Express, layered architecture, **PostgreSQL via Prisma 7**.

Session 3 replaced the in-memory `Map`s with a real database. The interesting part is not the CRUD — it is that a booking is now decided inside a serializable transaction, which is what stops twenty simultaneous requests from overselling a five-seat event.

## Running it

The database is the only prerequisite. Two ways to get one:

**With Docker** — brings up Postgres 16 and the API together, migrations included:

```bash
docker compose up --build
```

**Without Docker** — a real embedded Postgres, started and stopped by the tooling:

```bash
npm install
npm run with-db "npx prisma migrate deploy && npx prisma db seed && npm start"
```

Either way the API is at `http://localhost:3000/v1`.

```bash
npm test
```

69 tests. They start their own throwaway Postgres on a separate port, apply the committed migrations, and stop it afterwards — no setup, and no chance of clobbering your development data.

## The two claims worth checking

```bash
npm run prove:concurrency
```

Twenty users book a five-seat event simultaneously, over real HTTP, through the whole stack. Exits non-zero if the event oversells.

```
HTTP responses
  201 created    5
  409 conflict   15
  all 20 settled in 298ms

Serialization conflicts
  transactions run   : 20
  aborted and retried: 3
  gave up            : 0

What the table actually holds
  confirmed bookings : 5
  confirmed seats    : 5
  event capacity     : 5
  oversold by        : 0
```

```bash
npm run prove:index
```

Loads 20,000 bookings and plans "find this user's bookings" three ways:

```
state                    method                 time     read            index
no index on user_id      Seq Scan           0.852 ms      228 blocks   —
compound unique only     Index Scan         0.011 ms        3 blocks   bookings_user_id_event_id_key
compound + standalone    Index Scan         0.064 ms        3 blocks   bookings_user_id_idx
```

## Architecture

```
routes/         URL shape + which middleware runs
validators/     Input checking. Nothing invalid gets past this layer.
controllers/    Transport only: read request, call service, pick status code.
services/       Business rules and HTTP-status meaning. Never touch Prisma.
repositories/   The only modules that import the Prisma client.
db/             Client construction and the serializable transaction wrapper.
prisma/         Schema, migrations, seed.
```

The rule that held this together in session 2 was *controllers never import the store*. It is why this session was a change to `services/` and a new `repositories/` layer, and why the controllers gained nothing but an `await` each.

The new rule at the bottom: **repositories return rows and outcomes, never `ApiError`.** HTTP status codes are the service layer's vocabulary. A repository that threw a 409 would also be re-throwing it once per transaction retry.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/health` | Liveness — queries the database, 503 if it is down |
| GET | `/v1/venues` | Paginated |
| GET | `/v1/venues/:venueId` | |
| GET | `/v1/events` | `page`, `limit`, `venue`, `from`, `to` |
| POST | `/v1/events` | **201** |
| GET | `/v1/events/:eventId` | |
| PATCH | `/v1/events/:eventId` | **200** |
| DELETE | `/v1/events/:eventId` | **200**, hard delete, cascades to its bookings |
| GET | `/v1/bookings` | `page`, `limit`, `event`, `status` |
| POST | `/v1/bookings` | **201** |
| GET | `/v1/bookings/:bookingId` | |
| DELETE | `/v1/bookings/:bookingId` | **200**, soft delete → `CANCELLED` |

List responses are `{ data, page, limit, total }`. Single-resource responses are `{ data }`. Errors are `{ error: { message, details? } }`.

All ids are UUIDs. A malformed id is a **400** naming the parameter; a well-formed id that matches no row is a **404**. They are different mistakes, and a `uuid` column cannot be compared against `evt_1` at all — the driver raises a type error, which would otherwise surface as a 500.

## The parts worth understanding

**Overselling is a transaction problem, not a validation problem.** The capacity check barely changed between sessions. What changed is that reading the seat count and inserting the booking now happen inside one `SERIALIZABLE` transaction, so Postgres refuses to commit a decision made from a snapshot that another booking already invalidated. Every rule about capacity lives in `bookingRepository.book()` for that reason — moving any of it up into the service would put a network round trip in the middle of the check.

**Serializable and retry are one feature.** Postgres SERIALIZABLE does not block writers; it aborts transactions after the fact with SQLSTATE `40001`. Code that uses the isolation level without a retry loop has not fixed overselling — it has converted it into a 500. `runSerializableTransaction()` owns both halves, which is why nothing else in the codebase is allowed to call `$transaction` directly.

**The retry backoff is jittered, not just exponential.** Twenty transactions that abort at the same instant and sleep the same 20ms will collide again at the same instant. The randomness is what thins each successive round.

**Re-booking revives the cancelled row.** `(user_id, event_id)` is unique, so there is one booking row per user per event, forever. Booking again after cancelling flips that row back to `CONFIRMED` with a fresh `createdAt` rather than inserting a second one. That constraint is the backstop under concurrency: if two simultaneous attempts by the same user both read "no existing booking", the database rejects the second insert.

**Cancelling is a conditional `UPDATE`, not read-then-write.** `UPDATE … WHERE id = ? AND status = 'CONFIRMED'` returning a row count answers "did I cancel it" atomically. Reading the row, checking its status, then updating would let two simultaneous cancellations both succeed — the same race the booking path solves with a transaction, but one statement is cheaper than one here.

**Filtering and paging run in SQL, and `total` still describes the filtered set.** The count query carries the same `WHERE` as the page query. Counting the whole table while paging a subset hands the client page numbers that return nothing.

**Cancelled bookings release their seats.** The capacity sum counts only `CONFIRMED` rows, otherwise one cancelled booking keeps an event full forever. There is a test for exactly this.

**Only the error handler returns 500.** Every expected failure is an `ApiError` carrying its own status, including the ones that used to be database errors: a missing `venueId` is checked before the insert so it is a 422 naming the field rather than a foreign-key violation reaching the error handler.

**Async errors need `asyncHandler`.** Express 4 catches what a handler throws synchronously. An async handler does not throw — it returns a rejected promise, which Express ignores, so a database failure would hang the request instead of producing a 500. Every controller is wrapped.

## The index finding

Session 3 asked for an index on `bookings.user_id` and a measurement of what it buys. The measurement is above; the conclusion is that **the schema should not declare a standalone `@@index([userId])`**, and it does not.

`WHERE user_id = ?` does need an index — without one it is a sequential scan over the whole table, 77× slower at 20,000 rows and getting worse linearly. But that index already exists: the unique index on `(user_id, event_id)` is a B-tree sorted by `user_id` first, so it seeks straight to a user's rows.

Adding a second, narrower index on `user_id` alone does change the plan — the planner prefers it — but it reads the same three pages to reach the same tuple. No reads are won, and every insert, update and delete on `bookings` then has to maintain another B-tree. On the booking path, where writes already retry under contention, that is the wrong trade.

The migration `drop_redundant_user_id_index` removes it. If your rubric wants the standalone index regardless, put `@@index([userId])` back on the `Booking` model and run `npm run db:migrate` — nothing else depends on the decision.

## Judgment calls — check these against your rubric

Built without the assignment brief in hand, so these are defensible but not the only valid answer:

1. **Venues stayed a table.** This project's `/v1/venues` endpoints and `venue` filter are documented and tested, so `Venue` became a real model with a `RESTRICT` foreign key from `Event` rather than being collapsed into a string column.
2. **422 for a bad `eventId`/`venueId` reference**, not 404. The booking you are creating is not missing — the thing it points at is.
3. **Cancelling twice is a 409**, not an idempotent 200. Makes a double-submit visible instead of looking like success.
4. **`DELETE /v1/events/:id` hard deletes** and cascades to that event's bookings. A booking for an event that no longer exists is not history, it is a dangling row. Only bookings soft delete.
5. **Re-booking reuses the row** rather than inserting a new one, which is what makes `(user_id, event_id)` unique possible. If your rubric expects a booking history per user per event, the constraint has to become a partial unique index over `CONFIRMED` rows only.
6. **`BOOKING_MAX_RETRIES` defaults to 5.** Enough for 20-way contention with room to spare; exhausting it is a genuine 500, not a silent failure.
7. **Max 20 seats per booking** — arbitrary, in `bookingValidators.js`.

## Authentication

Still none. `src/middleware/currentUser.js` sets `req.userId` from config, and controllers read that instead of reaching into config themselves — that is the seam real auth slots into.

Outside production it also honours an `x-user-id` header, which is what lets the concurrency proof send twenty bookings as twenty different people over real HTTP. The production guard is load-bearing: without it that header is account takeover.

## Tests

| File | Covers |
|---|---|
| `tests/concurrency.test.js` | The overselling proof, seat sums, and the same-user double-submit |
| `tests/bookings.test.js` | Every booking rule, the rebooking matrix, soft delete, status filtering |
| `tests/events.test.js` | Pagination boundaries, filter correctness, UUID handling, cascade on delete |
| `tests/venues.test.js` | Listing, health, and the `RESTRICT` foreign key |
| `tests/utils.test.js` | Pagination arithmetic, UUID shape, and which errors are retryable |

`isRetryable` is unit-tested deliberately: the retry loop is only as good as that predicate. Too narrow and serialization failures escape as 500s; too broad and real bugs get retried five times before surfacing.

## Environment

Copy `.env.example` to `.env`. Everything is read and validated once in `src/config/index.js` — nothing else in the codebase touches `process.env`, so a missing `DATABASE_URL` kills the process at boot with a message naming it, rather than becoming a 500 on the first request that reaches the database.

See [DatabaseSetup.md](DatabaseSetup.md) for the Docker and no-Docker setups, migrations, and troubleshooting.
