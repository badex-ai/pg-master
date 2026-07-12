import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { seedDatabase } from '../db/seed';

/**
 * A dedicated PGlite instance used only for grading, kept separate from the learner's console
 * DB so grading always runs against pristine, seeded state — no matter what the learner deleted
 * or altered. Creating a PGlite is ~3-4s (WASM boot); reset-reseeding an existing one is ~290ms
 * (both measured), so we create ONCE and reuse, resetting per grade.
 *
 * Extensions are citext + btree_gist — the exact set the seed's `CREATE EXTENSION` DDL needs.
 * `live` is a client-side JS namespace the grader never uses, so it's omitted; the SQL-visible
 * environment is identical to the console DB.
 *
 * The creation *promise* is cached (on globalThis in dev, so fast-refresh doesn't leak a second
 * WASM boot per edit), so concurrent first-grades share one boot.
 */

const KEY = Symbol.for('pgmaster.gradingDb');
type Holder = { promise: Promise<PGlite> | null };
const g = globalThis as unknown as Record<symbol, Holder>;
const holder: Holder = g[KEY] ?? (g[KEY] = { promise: null });

export function getGradingDb(): Promise<PGlite> {
  if (!holder.promise) {
    holder.promise = (async () => {
      const db = await PGlite.create({ extensions: { citext, btree_gist } });
      await seedDatabase(db);
      return db;
    })();
  }
  return holder.promise;
}

/** Kick off creation without waiting — call on write-query card mount so the ~4s boot overlaps typing. */
export function prewarmGradingDb(): void {
  void getGradingDb();
}
