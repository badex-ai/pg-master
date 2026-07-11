import type { PGlite } from '@electric-sql/pglite';
import { SCHEMA_SQL } from './schema.sql';
import { SEED_SQL, SEQUENCE_FIXUP_SQL } from './seed.sql';

/**
 * All tables in dependency order (parents first). Used to detect existing data
 * and, in reverse, to drop cleanly on reset.
 */
const TABLES = [
  'categories',
  'users',
  'products',
  'orders',
  'order_items',
  'shipments',
  'payments',
  'reviews',
  'inventory',
  'bookings',
] as const;

/** True once the schema exists and the curated rows are present. */
async function isSeeded(db: PGlite): Promise<boolean> {
  const res = await db.query<{ present: boolean }>(
    `SELECT to_regclass('public.users') IS NOT NULL AS present`,
  );
  if (!res.rows[0]?.present) return false;
  const count = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM users`);
  return (count.rows[0]?.c ?? 0) > 0;
}

/**
 * Create the schema and load the curated sample data. Idempotent: if the data is
 * already present (e.g. a dev fast-refresh re-runs the init effect) this is a no-op,
 * so it never double-seeds or trips a unique violation.
 */
export async function seedDatabase(db: PGlite): Promise<void> {
  if (await isSeeded(db)) return;
  await db.exec(SCHEMA_SQL);
  await db.exec(SEED_SQL);
  await db.exec(SEQUENCE_FIXUP_SQL);
}

/**
 * Restore the database to the curated seed, discarding any edits the learner made.
 * Drops every table (reverse dependency order) then rebuilds from scratch, so it
 * recovers even if the learner altered the schema, not just the rows.
 */
export async function resetDatabase(db: PGlite): Promise<void> {
  const drops = [...TABLES].reverse().map((t) => `DROP TABLE IF EXISTS ${t} CASCADE;`).join('\n');
  await db.exec(drops);
  await db.exec(SCHEMA_SQL);
  await db.exec(SEED_SQL);
  await db.exec(SEQUENCE_FIXUP_SQL);
}
