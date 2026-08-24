# Database setup

Evently runs on PostgreSQL 16+ through Prisma 7's `@prisma/adapter-pg` driver adapter.

## Option A — Docker

```bash
docker compose up --build
```

Brings up two services:

| Service | Image | Port | Notes |
|---|---|---|---|
| `db` | `postgres:16-alpine` | 5432 | Data persists in the `evently-pgdata` volume |
| `api` | built from `./Dockerfile` | 3000 | Runs `prisma migrate deploy` before starting |

The API waits on a `pg_isready` healthcheck rather than on the container merely existing — `depends_on` alone would let migrations run against a server that has not finished starting.

`src/`, `prisma/` and `scripts/` are bind-mounted and the server runs under `node --watch`, so edits reload without a rebuild. `node_modules` is deliberately *not* mounted: the host's copy is built for a different platform and would shadow the Linux binaries Prisma needs.

## Option B — No Docker

`scripts/local-postgres.js` downloads and runs a real PostgreSQL server — not an emulator, which matters, since the whole point of the booking path is Postgres's own SERIALIZABLE implementation.

Run a one-off command against a database that exists only for its duration:

```bash
npm run with-db "npx prisma migrate deploy && npx prisma db seed && npm start"
```

Or keep a server up in one terminal and work against it in another:

```bash
npm run db:local
```

It prints the `DATABASE_URL` to put in your `.env`. Data lives in `.pgdata/` (gitignored) and persists between runs.

| | Port | Database | Data directory |
|---|---|---|---|
| Development | 55432 | `evently` | `.pgdata/` |
| Tests | 55433 | `evently_test` | `.pgdata-test/` |

Non-standard ports so neither collides with a Postgres you already have, and a separate cluster for tests because the suite `TRUNCATE`s between cases — pointing it at the development database would quietly delete whatever you were working on.

## Environment

```bash
cp .env.example .env
```

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | No safe default; guessing it means writing to the wrong database |
| `PORT` | no | `3000` | |
| `NODE_ENV` | no | `development` | `production` disables the `x-user-id` header |
| `BOOKING_MAX_RETRIES` | no | `5` | Serializable retry budget. `0` disables retrying |
| `BOOKING_BACKOFF_MS` | no | `20` | Base for the jittered exponential backoff |
| `CURRENT_USER_ID` | no | first seeded user | Must be a real `users` row or bookings fail their foreign key |
| `DB_LOG` | no | — | `silent` suppresses Prisma's query-error log; the proof scripts set it |

Validation happens once, at boot, in `src/config/index.js`. Every problem is reported together rather than one restart at a time.

Prisma 7 no longer reads `.env` itself and no longer takes the connection URL from the schema — both are handled in `prisma.config.js`.

## Commands

| Command | Does |
|---|---|
| `npm run db:migrate` | Create and apply a migration from schema changes (`prisma migrate dev`) |
| `npm run db:deploy` | Apply committed migrations (`prisma migrate deploy`) — what CI and Docker run |
| `npm run db:seed` | Idempotent seed: 23 users, 3 venues, 6 events |
| `npm run db:reset` | Drop, re-migrate, re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run with-db "<cmd>"` | Run `<cmd>` against a temporary local Postgres |
| `npm run prove:concurrency` | 20 simultaneous bookings on a 5-seat event |
| `npm run prove:index` | `EXPLAIN ANALYZE` across three index states |

## Schema

Four tables. Column names are snake_case; the JS side stays camelCase via Prisma's `@map`.

| Table | Key points |
|---|---|
| `venues` | `RESTRICT` on delete — cannot be removed while events reference it |
| `users` | Unique email. Exists so bookings have a real owner |
| `events` | FK to venue. Indexed on `starts_at` and `(venue_id, starts_at)` |
| `bookings` | FK to event (`CASCADE`) and user. Unique `(user_id, event_id)`, indexed `(event_id, status)` |

Every timestamp is `timestamptz`. A wall-clock time with no offset makes "when does this event start" unanswerable the moment two clients sit in different zones.

`bookings.status` is a real Postgres enum (`CONFIRMED` / `CANCELLED`), so the database rejects a typo that a text column would happily store.

### Migrations

| Migration | What it does |
|---|---|
| `init_postgres_persistence` | Tables, enum, foreign keys, indexes |
| `drop_redundant_user_id_index` | Removes the standalone `user_id` index — see the index finding in the README |

## Troubleshooting

**`P1001: Can't reach database server`** — nothing is listening. With Docker, `docker compose ps` and check `db` is healthy. Without, the embedded server only lives as long as the process that started it: `npm run db:local` in its own terminal, or wrap the command in `npm run with-db`.

**`DATABASE_URL is required`** — no `.env`, or it is not where the process is running. Copy `.env.example`. Docker sets the variable directly on the container and does not need the file.

**`The table 'public.events' does not exist`** — migrations have not run. `npm run db:deploy`.

**Port 5432 already in use** — a Postgres is already running. Change the host side of the port mapping in `docker-compose.yml`, or use the no-Docker path, which defaults to 55432.

**Tests fail on a fresh clone** — they start their own server; if `.pgdata-test/` is in a bad state from an interrupted run, delete it and let it rebuild.

**`could not serialize access due to read/write dependencies` in the logs** — expected, not a fault. That is Postgres aborting a booking whose snapshot another booking invalidated, and the retry loop running it again. `npm run prove:concurrency` counts them. `LOCAL_PG_VERBOSE=1` shows the server's own log if you want to watch.
