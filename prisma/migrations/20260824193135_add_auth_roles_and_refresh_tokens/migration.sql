-- Session 4: authentication, roles, event ownership, refresh tokens.
--
-- Three of these columns are NOT NULL on tables that already have rows, so the
-- generated migration could not run as written. Adding a column, backfilling it
-- and only then constraining it is the ordinary way through that, and it is
-- what the hand-edits below do. The alternative — dropping and recreating the
-- tables — is fine on a laptop and is data loss anywhere else.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ATTENDEE', 'ORGANIZER');

-- AlterTable: users
--
-- password_hash is backfilled with '!' rather than any real hash. '!' is not
-- valid bcrypt output, so bcrypt.compare can never return true for it: existing
-- accounts are locked out rather than given a password somebody could guess from
-- reading this file. They regain access through a reset, or through the seed.
ALTER TABLE "users"
  ADD COLUMN "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "role" "Role" NOT NULL DEFAULT 'ATTENDEE',
  ADD COLUMN "password_hash" VARCHAR(255) NOT NULL DEFAULT '!';

-- The default was scaffolding for the backfill. Leaving it would mean a future
-- INSERT that forgets a password silently creates a locked account instead of
-- failing, which is a bug that hides for months.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP DEFAULT;

-- updated_at is maintained by Prisma's @updatedAt, so it must not carry a
-- database default either.
ALTER TABLE "users" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable: events
--
-- Existing events predate ownership, so they are assigned to the oldest account
-- and promoted with it. Picking deterministically (lowest id) rather than
-- arbitrarily means re-running this on a copy of the data gives the same result.
ALTER TABLE "events" ADD COLUMN "organizer_id" UUID;

UPDATE "events"
SET "organizer_id" = (SELECT "id" FROM "users" ORDER BY "id" LIMIT 1)
WHERE "organizer_id" IS NULL;

-- Whoever inherited those events needs to be able to edit them.
UPDATE "users"
SET "role" = 'ORGANIZER'
WHERE "id" IN (SELECT DISTINCT "organizer_id" FROM "events" WHERE "organizer_id" IS NOT NULL);

-- Only now is the column safe to constrain. An events table with no rows skips
-- the backfill harmlessly and lands here just the same.
ALTER TABLE "events" ALTER COLUMN "organizer_id" SET NOT NULL;

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Unique because the hash is how a token is looked up, and it is the only
-- identifier a client ever presents.
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
-- Unique so a rotation chain stays a chain: one token can replace exactly one.
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_id_key" ON "refresh_tokens"("replaced_by_id");

-- CreateIndex
-- Revoking every token a user holds — the response to a reuse attempt — filters
-- on user_id, and nothing else here leads with that column.
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "events_organizer_id_idx" ON "events"("organizer_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Deleting a user takes their sessions with them: a live refresh token for an
-- account that no longer exists is a session nobody can revoke.
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not CASCADE: deleting an organizer must not silently delete the
-- events people have already booked onto.
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
