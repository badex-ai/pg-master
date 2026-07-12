'use client';

import { useMemo } from 'react';
import type { QueryResult } from '@/lib/executeSql';

export type { QueryResult };

// Postgres numeric type OIDs — these columns are right-aligned like a real DB client.
// int2, int4, int8, oid, float4, float8, numeric, money. Re-exported for the grader's
// comparator, which uses the same set to decide value canonicalization.
export const NUMERIC_OIDS = new Set([21, 23, 20, 26, 700, 701, 1700, 790]);

// Cap how many rows are put in the DOM. A curious learner can `SELECT generate_series
// (1, 1000000)` and the performance lessons inflate tables to millions of rows; render
// all of them and the tab freezes. The full row count is still reported by the caller.
const MAX_RENDERED_ROWS = 500;

/** Render a single cell value the way a psql/pgAdmin grid would. Always a text node. */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 't' : 'f';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    return '\\x' + Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

type ResultGridProps = {
  result: QueryResult;
};

/**
 * Renders a PGlite result set as a DB-client-style grid: monospace, zebra rows,
 * numbers right-aligned by column type, NULLs shown as an explicit greyed chip
 * (blank ≠ NULL is a concept we teach). Objects (jsonb) render as compact JSON.
 * Every cell is a React text node — query output is never treated as HTML.
 */
export function ResultGrid({ result }: ResultGridProps) {
  const numericCols = useMemo(
    () => new Set(result.fields.filter((f) => NUMERIC_OIDS.has(f.dataTypeID)).map((f) => f.name)),
    [result.fields],
  );

  // A statement with no result set (DML/DDL): show rows-affected instead of a grid.
  if (result.fields.length === 0) {
    return (
      <p className="font-mono text-sm text-neutral-500">
        {result.affectedRows ?? 0} row{(result.affectedRows ?? 0) === 1 ? '' : 's'} affected
      </p>
    );
  }

  const truncated = result.rows.length > MAX_RENDERED_ROWS;
  const visibleRows = truncated ? result.rows.slice(0, MAX_RENDERED_ROWS) : result.rows;

  return (
    <div className="overflow-x-auto rounded border border-neutral-300">
      <table className="w-full border-collapse font-mono text-sm">
        <thead>
          <tr className="bg-neutral-100 text-left">
            {result.fields.map((f) => (
              <th
                key={f.name}
                className={`border-b border-neutral-300 px-3 py-1.5 font-semibold ${
                  numericCols.has(f.name) ? 'text-right' : 'text-left'
                }`}
              >
                {f.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.length === 0 ? (
            <tr>
              <td
                colSpan={result.fields.length}
                className="px-3 py-2 text-center text-neutral-400"
              >
                (0 rows)
              </td>
            </tr>
          ) : (
            visibleRows.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? 'bg-neutral-50' : undefined}>
                {result.fields.map((f) => {
                  const value = row[f.name];
                  const isNull = value === null || value === undefined;
                  return (
                    <td
                      key={f.name}
                      className={`border-b border-neutral-200 px-3 py-1 ${
                        numericCols.has(f.name) ? 'text-right tabular-nums' : 'text-left'
                      }`}
                    >
                      {isNull ? (
                        <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-500">
                          NULL
                        </span>
                      ) : (
                        formatCell(value)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {truncated && (
        <p className="border-t border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-500">
          Showing first {MAX_RENDERED_ROWS.toLocaleString()} of {result.rows.length.toLocaleString()} rows
        </p>
      )}
    </div>
  );
}
