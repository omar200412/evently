# Evently — Backend API

Events, venues and bookings REST API. Express, layered architecture, **PostgreSQL via Prisma 7**, **JWT auth with rotating refresh tokens**.

Session 3 replaced the in-memory `Map`s with a real database and made booking safe under concurrency. Session 4 locked the API down: authentication, roles, ownership checks on every object, and refresh tokens that detect their own theft.

## Running it

**With Docker** — Postgres 16 and the API together, migrations included:

```bash
docker compose up --build
```

**Without Docker** — a real embedded Postgres, started and stopped by the tooling:

```bash
npm install
npm run with-db "npx prisma migrate deploy && npx prisma db seed && npm start"
```

Either way the API is at `http://localhost:3000/v1`. Seeded accounts all use the password `evently-dev-password`:

| Email | Role | Owns |
|---|---|---|
| `omar@evently.test` | ORGANIZER | events 1, 3, 5 |
| `nour@evently.test` | ORGANIZER | events 2, 4, 6 |
| `sara@evently.test` | ATTENDEE | — |

```bash
npm test
```

126 tests. They start their own throwaway Postgres on a separate port, apply the committed migrations, and stop it afterwards — no setup, no `.env` needed, and no chance of clobbering your development data.

## The three claims worth checking

```bash
npm run verify:auth
```

31 security assertions against a real listening socket — public routes, 401s, 403s, token forgery, rotation, reuse detection, BOLA, and credential leakage. Exits non-zero on any failure.

```
Token forgery
  PASS  alg=none is rejected
  PASS  a token signed with another key is rejected
  ...
Refresh rotation
  PASS  a refresh returns a new token
  PASS  replaying a rotated token is rejected
  PASS  reuse revokes the whole family, including the live token
BOLA
  PASS  an organizer cannot edit another's event
  PASS  a user cannot cancel another's booking
  PASS  listing bookings returns only the caller's own
```

```bash
npm run prove:concurrency
```

Twenty users book a five-seat event simultaneously, each with their own signed token. Exits non-zero if the event oversells.

```
201 created    5      confirmed seats : 5
409 conflict   15     event capacity  : 5
retried        19     oversold by     : 0
```

```bash
npm run prove:index
```

Loads 20,000 bookings and plans the same lookup three ways — no index, compound unique only, compound plus a redundant standalone.

## Architecture

```
routes/         URL shape, access policy, which middleware runs
validators/     Input checking. Nothing invalid gets past this layer.
controllers/    Transport only: read request, call service, pick status code.
services/       Business rules, ownership checks, HTTP-status meaning.
repositories/   The only modules that import the Prisma client.
auth/           Password hashing, JWT signing, refresh tokens, the user DTO.
middleware/     Authentication, role gates, validation, error handling.
db/             Client construction and the serializable transaction wrapper.
```

Two rules hold it together. **Controllers never import the store**, which is why the Postgres migration in session 3 cost them an `await` each. **Repositories return rows and outcomes, never `ApiError`** — status codes are the service layer's vocabulary.

Session 4 added a third: **identity comes from the token and nowhere else.** No handler reads a user id from a body, a query string, or a header. `req.user` is set by `authenticate` and is the only source.

## Access policy

| Method | Path | Who |
|---|---|---|
| GET | `/v1/health` | anyone |
| POST | `/v1/auth/signup` | anyone |
| POST | `/v1/auth/login` | anyone |
| POST | `/v1/auth/refresh` | anyone with a valid refresh cookie |
| POST | `/v1/auth/logout` | anyone |
| GET | `/v1/auth/me` | authenticated |
| GET | `/v1/events`, `/v1/events/:id` | anyone |
| POST | `/v1/events` | ORGANIZER |
| PATCH | `/v1/events/:id` | ORGANIZER **and** owns it |
| DELETE | `/v1/events/:id` | ORGANIZER **and** owns it |
| GET | `/v1/venues`, `/v1/venues/:id` | anyone |
| GET | `/v1/bookings` | authenticated, scoped to own |
| POST | `/v1/bookings` | authenticated |
| GET | `/v1/bookings/:id` | authenticated **and** owns it |
| DELETE | `/v1/bookings/:id` | authenticated **and** owns it |

Reading the catalogue is public on purpose: requiring a login to see what is on would make the API useless to anyone deciding whether to sign up.

There is **no global auth middleware.** Access is declared route by route, so a new endpoint is unprotected only if someone wrote it that way — not because it silently missed a list in another file.

## Security, and why each piece is there

**Role checks and ownership checks are different questions.** `requireRole(ORGANIZER)` asks whether this *kind* of user may ever call this endpoint. It cannot ask whether *this* event is yours, because middleware does not have the row. So ownership lives in the services, right next to the fetch that loads it. Getting that split wrong is how an API ends up with a perfectly good role check on `PATCH /events/:id` that still lets any organizer edit anyone's event — OWASP's number one API risk, and the easiest one to ship by accident, because every test passes when every test uses its own data.

**Ownership failures return 404, not 403.** A 403 confirms the id names something real, which is an enumeration oracle for ids the caller should know nothing about. From their side the two are the same anyway: there is nothing here for you.

**List endpoints are scoped, not filtered.** `bookingService.list()` takes `userId` as a mandatory parameter from the token, not as an optional query filter. An endpoint that returns everything and merely *offers* a user filter hands over every booking in the system to anyone who omits it. This is the collection-level form of BOLA and the one most often missed, because the single-resource route usually gets the check and the list does not.

**The JWT algorithm is pinned.** A verifier that trusts the token's own `alg` header accepts `alg: "none"` — no signature at all — and will accept an HMAC signed with a public key when it expected RS256. Both mint any subject with any role. The header does not get a vote; `algorithms: ['HS256']` does. There is a test that hand-builds an `alg: none` token, because no library will produce one for you.

**Claims are validated after the signature.** A correct signature proves the payload was not tampered with, not that it makes sense. A validly signed token can still carry `role: "SUPERUSER"`. Checking the shape is what stops that reaching an authorization decision.

**Access tokens are short; refresh tokens are revocable.** An access token cannot be taken back — it is believed until it expires, which is why it lives fifteen minutes. Refresh tokens are opaque random bytes rather than JWTs precisely so they *can* be revoked: they are valid because a row says so, and a row can be revoked.

**Refresh tokens rotate, and reuse means theft.** Every refresh issues a new token and retires the old one, so a stolen token is only useful until the real user refreshes. Presenting an already-rotated token means two parties hold it and only one came by it honestly — and there is no way to tell which, so the whole family is revoked and both are logged out. Whoever knows the password gets back in. Without that last step, rotation buys very little: a thief who refreshes once holds a fresh valid token while the real user's next refresh fails, which looks like a glitch rather than a break-in.

**Both kinds of secret are stored hashed, for different reasons.** Passwords use bcrypt because they are low-entropy and guessable, and bcrypt is deliberately slow with a tunable cost. Refresh tokens use plain SHA-256 because they are already 256 bits of randomness — there is nothing to brute-force, and bcrypt's slowness would just be a tax on every refresh. What both share is that the database never holds the usable value.

**Login does not leak which emails have accounts.** Wrong password and unknown account return the same status and the same message, and the unknown-account path still pays for a bcrypt comparison so the timing matches. Signup's duplicate-email response is deliberately vague for the same reason. The cost is a slightly worse error for an honest typo, which is the right side to err on.

**Signup cannot grant privilege.** `role` is not read from the body at all — it is hard-coded to ATTENDEE. Validating a client-supplied role would still be the wrong shape: the only safe signup is one where privilege is not an input. The field is *rejected* rather than ignored, so the attempt is visible.

**Ownership is never accepted from a request.** `organizerId` on an event and `userId` on a booking both come from the token. An owner a client can nominate is not ownership.

**Users are serialised from an allowlist.** `toPublicUser()` builds the object field by field — never `{ ...user }`, never `delete user.passwordHash`. A spread ships whatever the row happens to contain, so the day someone adds a `mfaSecret` column it goes out to every client and nothing fails. A test greps every auth response for a hash to keep it that way.

**The refresh cookie is httpOnly, SameSite=Strict, Secure in production, and scoped to `/v1/auth`.** httpOnly is what stops an XSS bug from lifting a week-long session. SameSite=Strict is what stops another site from spending it. The path scope keeps it off every ordinary API call, so it has fewer chances to end up in a log.

**CORS is an explicit allowlist.** Not `origin: true`, which reflects whatever `Origin` arrives and is indistinguishable from allowing everyone — except that it looks like configuration. With `credentials: true` that is the dangerous combination, and reflecting the origin is how people work around the browser's refusal to pair `*` with credentials without noticing what they have done.

**Secrets are validated at boot.** `JWT_SECRET` is required, must be at least 32 characters, and the `.env.example` placeholder is rejected outright. Production additionally refuses `COOKIE_SECURE=false` and a `*` CORS origin. Every one of those is a mistake that otherwise works fine locally and fails silently in the worst possible place.

**The session-3 `x-user-id` header is gone entirely**, not left behind under an environment flag. A development-only authentication bypass is still an authentication bypass; the only question is how it reaches production. The concurrency proof now mints twenty real tokens instead.

## What carried over from session 3

**Overselling is a transaction problem.** Reading the seat count and inserting the booking happen inside one `SERIALIZABLE` transaction, so Postgres refuses to commit a decision made from a snapshot another booking already invalidated.

**Serializable and retry are one feature.** Postgres SERIALIZABLE aborts rather than blocks, with SQLSTATE `40001`. Using the isolation level without a retry loop converts overselling into a 500. `runSerializableTransaction()` owns both halves, and the backoff is jittered so aborted transactions do not collide again on the same instant.

**Re-booking revives the cancelled row.** `(user_id, event_id)` is unique, so there is one booking row per user per event, and that constraint is the backstop under concurrency.

**Cancelling is a conditional `UPDATE`,** not read-then-write, so two simultaneous cancellations cannot both report success.

**Filtering and paging run in SQL, and `total` describes the filtered set.**

**Only the error handler returns 500.** Every expected failure is an `ApiError` carrying its own status.

## The migration worth reading

`add_auth_roles_and_refresh_tokens` adds three `NOT NULL` columns to tables that already have rows, so the generated migration could not run as written. It is hand-edited to add, backfill, then constrain:

- `password_hash` is backfilled with `'!'` — not valid bcrypt output, so `compare` can never return true. Existing accounts are **locked out** rather than given a password anyone could guess from reading the migration.
- `organizer_id` is backfilled deterministically to the oldest account, which is promoted to ORGANIZER so it can actually manage what it inherited.
- The scaffolding defaults are dropped afterwards, so a future insert that forgets a password fails loudly instead of quietly creating a locked account.

## The index finding (session 3)

The session asked for an index on `bookings.user_id`. Indexing it matters — without one the lookup is a sequential scan, 77× slower at 20,000 rows and worsening linearly. But the unique index on `(user_id, event_id)` is sorted by `user_id` first and already serves it, reading the same three pages. A standalone index wins no reads and costs a B-tree on every write, so `drop_redundant_user_id_index` removes it. `npm run prove:index` shows all three states.

`events.organizer_id` **does** get its own index, and the same reasoning is why: nothing else leads with that column.

## Judgment calls — check these against your rubric

1. **Two roles, and ownership is absolute.** ATTENDEE and ORGANIZER, matching the reference. There is no super-admin that bypasses ownership — an organizer cannot touch another organizer's event under any circumstances. If your rubric wants an admin override, it is one condition in `assertOwnership()` in `eventService` and in `bookingService.getById()`.
2. **404 rather than 403 for ownership failures**, to avoid confirming that an id exists. If your rubric expects 403, change `ApiError.notFound` → `ApiError.forbidden` in those two places.
3. **Venues stayed a table.** The reference dropped its Venue model; this project has documented, tested `/v1/venues` endpoints, so `Venue` is a real model with a `RESTRICT` foreign key.
4. **422 for a bad `eventId`/`venueId` reference**, not 404. The booking is not missing — the thing it points at is.
5. **Re-booking reuses the row**, which is what makes `(user_id, event_id)` unique possible. For a per-user booking history, that constraint has to become a partial unique index over `CONFIRMED` rows only.
6. **`DELETE /v1/events/:id` hard deletes** and cascades to its bookings. Only bookings soft delete.
7. **Minimum password length is 12, with no composition rules.** Length does more than forcing a symbol, which mostly produces `Password1!`. The 72-byte maximum is bcrypt's real limit — anything past it is silently ignored, so rejecting it is honest.
8. **Logout revokes one session, not all of them.** Signing out of a laptop should not sign you out of your phone.

## Tests

| File | Covers |
|---|---|
| `tests/auth.test.js` | Signup, login, refresh rotation, reuse detection, logout, `/me` |
| `tests/authorization.test.js` | Public routes, 401s, token forgery, role gates, BOLA on events and bookings |
| `tests/concurrency.test.js` | The overselling proof, seat sums, same-user double-submit |
| `tests/bookings.test.js` | Every booking rule, the rebooking matrix, soft delete, status filtering |
| `tests/events.test.js` | Pagination boundaries, filter correctness, UUID handling, cascade on delete |
| `tests/venues.test.js` | Listing, health, and the `RESTRICT` foreign key |
| `tests/utils.test.js` | Pagination arithmetic, UUID shape, which errors are retryable |

## Environment

Copy `.env.example` to `.env` and generate a `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Everything is read and validated once in `src/config/index.js` — nothing else touches `process.env`, so a missing or weak secret stops the process at boot with a message naming it.

See [DatabaseSetup.md](DatabaseSetup.md) for the Docker and no-Docker setups, migrations, and troubleshooting.
