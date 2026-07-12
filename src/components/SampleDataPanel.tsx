'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePGlite } from '@electric-sql/pglite-react';
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
  const db = usePGlite();
  const resetEpoch = useResetEpoch();

  const [table, setTable] = useState<SampleTable>('users');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (t: SampleTable) => {
      try {
        const res = await db.query(`SELECT * FROM "${t}" ORDER BY 1 LIMIT ${SAMPLE_LIMIT}`);
        setResult({
          rows: res.rows as Record<string, unknown>[],
          fields: res.fields,
          affectedRows: res.affectedRows,
        });
        setError(null);
      } catch (e) {
        setError(String(e));
        setResult(null);
      }
    },
    [db],
  );

  // Load on table change and after a reset (resetEpoch bump re-fetches current table).
  useEffect(() => {
    void load(table);
  }, [load, table, resetEpoch]);

  return (
    <section className="flex flex-col gap-2" aria-label="Sample data">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-600">Sample data</h2>
        <span className="font-mono text-xs text-neutral-400">the curated {SAMPLE_LIMIT} rows</span>
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

      {error ? (
        <p className="font-mono text-sm text-red-600">{error}</p>
      ) : result ? (
        <ResultGrid result={result} />
      ) : (
        <p className="font-mono text-sm text-neutral-400">Loading…</p>
      )}
    </section>
  );
}
