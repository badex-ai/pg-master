'use client';

import { useState } from 'react';
import { useLiveQuery } from '@electric-sql/pglite-react';
import { useResetEpoch } from '@/lib/db/provider';
import { ResultGrid, type QueryResult } from './ResultGrid';

/**
 * The seeded tables, in the order DATASET.md presents them. These are the tabs; the
 * active one drives `SELECT * FROM <table>`. Fixed allowlist — the name is only ever
 * one of these, so interpolating it as an identifier is safe.
 */
const SAMPLE_TABLES = [
  'users',
  'categories',
  'products',
  'orders',
  'order_items',
  'shipments',
  'payments',
  'reviews',
  'inventory',
  'bookings',
] as const;

type SampleTable = (typeof SAMPLE_TABLES)[number];

// A few rows are enough to recall the columns and see the edge cases; the curated
// sample is 10 per table. Kept modest so the always-visible panel stays glanceable.
const SAMPLE_LIMIT = 10;

/**
 * An always-visible panel showing the curated sample rows for one table, so the learner
 * can see the data (columns, NULLs, JSONB) while writing SQL without running `SELECT *`.
 * Renders with the same ResultGrid as query output, so the panel and results look alike.
 * Refetches when the table changes and after a database reset.
 */
export function SampleDataPanel() {
  const [table, setTable] = useState<SampleTable>('users');
  const resetEpoch = useResetEpoch();

  // A live query: the panel reflects the active table's current rows and updates itself
  // whenever the data changes (a learner's INSERT/UPDATE/DELETE), so it never shows stale
  // rows. The table name is from a fixed allowlist — safe to inline.
  //
  // The `epoch` comment forces a fresh subscription after a reset. Reset does
  // `DROP SCHEMA public CASCADE`, which silently kills a live subscription watching the
  // dropped relation — it never fires again, even once the table is recreated. Changing
  // the query text (the epoch bump) makes useLiveQuery unsubscribe the dead watcher and
  // resubscribe against the new relation, so the panel tracks the re-seeded data.
  //
  // NOTE: useLiveQuery has no error channel — if this query ever fails (e.g. the table
  // doesn't exist) the hook silently never resolves and the panel is stuck on "Loading…"
  // with an unhandled rejection. Safe today only because `table` is from the fixed
  // allowlist above; revisit if the tab list ever becomes dynamic.
  const live = useLiveQuery(
    `SELECT * FROM "${table}" ORDER BY 1 LIMIT ${SAMPLE_LIMIT} -- epoch:${resetEpoch}`,
  );
  const result: QueryResult | null = live
    ? { rows: live.rows as Record<string, unknown>[], fields: live.fields }
    : null;

  return (
    <section className="flex flex-col gap-2" aria-label="Sample data">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-600">Sample data</h2>
        <span className="font-mono text-xs text-neutral-400">live · first {SAMPLE_LIMIT} rows</span>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Tables">
        {SAMPLE_TABLES.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === table}
            onClick={() => setTable(t)}
            className={`rounded px-2 py-0.5 font-mono text-xs ${
              t === table
                ? 'bg-neutral-800 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {result ? (
        <ResultGrid result={result} />
      ) : (
        <p className="font-mono text-sm text-neutral-400">Loading…</p>
      )}
    </section>
  );
}
