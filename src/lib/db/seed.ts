import type { PGlite } from '@electric-sql/pglite';
import { SCHEMA_SQL } from './schema.sql';
import { SEED_SQL, SEQUENCE_FIXUP_SQL } from './seed.sql';

/**
 * Schema + curated data + sequence fixup as ONE statement batch. PGlite's `exec`
 * runs a batch in a single implicit transaction, so this is atomic: it either fully
 * succeeds or rolls back entirely, never leaving a half-seeded database. That
 * atomicity is what lets `isSeeded` trust the schema's mere presence.
 */
const FULL_SEED_SQL = `${SCHEMA_SQL}\n${SEED_SQL}\n${SEQUENCE_FIXUP_SQL}`;

/**
 * True once the database has been seeded. Because seeding is atomic (see
 * FULL_SEED_SQL), the presence of a seeded table implies the whole seed committed —
 * so we can check schema presence alone and need not count rows. (Counting rows
 * would wrongly report "unseeded" if a learner deleted everything, causing a
 * destructive re-seed of their session.)
 */
async function isSeeded(db: PGlite): Promise<boolean> {
  const res = await db.query<{ present: boolean }>(
    `SELECT to_regclass('public.users') IS NOT NULL AS present`,
  );
  return res.rows[0]?.present ?? false;
}

/**
 * Create the schema and load the curated sample data. Idempotent: if already seeded
 * (e.g. a dev fast-refresh re-runs the init effect) this is a no-op, so it never
 * double-seeds or trips a unique violation.
 */
export async function seedDatabase(db: PGlite): Promise<void> {
  if (await isSeeded(db)) return;
  await db.exec(FULL_SEED_SQL);
}

/**
 * Restore the database to the curated seed, discarding everything the learner did.
 *
 * Drops the entire `public` schema and rebuilds it, so it recovers from ANY learner
 * change — not just edited rows, but tables, indexes, views, or functions the learner
 * created while practising DDL. (A fixed drop-list would silently leave learner-created
 * objects behind; teaching CREATE TABLE means reset must undo it.) The rebuild re-runs
 * `CREATE EXTENSION IF NOT EXISTS`, which re-registers citext/btree_gist against the
 * already-loaded PGlite WASM modules.
 */
export async function resetDatabase(db: PGlite): Promise<void> {
  await db.exec(`DROP SCHEMA public CASCADE;\nCREATE SCHEMA public;\n${FULL_SEED_SQL}`);
}
