'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePGlite } from '@electric-sql/pglite-react';
import { useResetDatabase, useResetEpoch } from '@/lib/db/provider';
import { SqlEditor, DEFAULT_SCHEMA, type EditorSchema } from './SqlEditor';
import { ResultGrid, type QueryResult } from './ResultGrid';

const INITIAL_SQL = 'SELECT * FROM users;';

/**
 * The core practice surface: a SQL editor wired to the in-browser Postgres, with the
 * result rendered in a DB-client-style grid. Owns the SQL text and the last result/error.
 * Refetches after a database reset, and keeps autocomplete honest by refreshing the
 * editor schema from information_schema after each successful run.
 */
export function QueryConsole() {
  const db = usePGlite();
  const reset = useResetDatabase();
  const resetEpoch = useResetEpoch();

  const [sql, setSql] = useState(INITIAL_SQL);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [schema, setSchema] = useState<EditorSchema>(DEFAULT_SCHEMA);

  // Latest SQL, so the reset-triggered refetch runs what's currently in the editor
  // without making `sql` a dependency of the run callback.
  const sqlRef = useRef(sql);
  sqlRef.current = sql;

  const refreshSchema = useCallback(async () => {
    const res = await db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    );
    const next: EditorSchema = {};
    for (const { table_name, column_name } of res.rows) {
      (next[table_name] ??= []).push(column_name);
    }
    if (Object.keys(next).length > 0) setSchema(next);
  }, [db]);

  const run = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      setRunning(true);
      setError(null);
      try {
        const res = await db.query(trimmed);
        setResult({ rows: res.rows as Record<string, unknown>[], fields: res.fields, affectedRows: res.affectedRows });
        // A statement may have changed the schema; keep autocomplete current.
        await refreshSchema();
      } catch (e) {
        setError(String(e));
        setResult(null);
      } finally {
        setRunning(false);
      }
    },
    [db, refreshSchema],
  );

  // After a reset, the data (and possibly schema) changed underneath us: re-run the
  // current query so the grid reflects the freshly re-seeded database. Skipped on the
  // initial mount (resetEpoch 0) so nothing runs until the learner does.
  useEffect(() => {
    if (resetEpoch > 0) void run(sqlRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetEpoch]);

  const handleReset = useCallback(async () => {
    setRunning(true);
    try {
      await reset();
    } finally {
      setRunning(false);
    }
  }, [reset]);

  return (
    <div className="flex flex-col gap-3">
      <SqlEditor value={sql} onChange={setSql} onRun={run} schema={schema} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => run(sql)}
          disabled={running}
          className="rounded bg-neutral-800 px-3 py-1 text-sm text-white disabled:opacity-50"
          title="Run query (Cmd/Ctrl+Enter)"
        >
          Run ▸
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={running}
          className="rounded border border-neutral-300 px-3 py-1 text-sm disabled:opacity-50"
          title="Restore the sample data"
        >
          Reset database
        </button>
        <span className="font-mono text-xs text-neutral-400">Cmd/Ctrl+Enter to run</span>
      </div>

      {error ? (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-red-300 bg-red-50 p-3 font-mono text-sm text-red-700">
          {error}
        </pre>
      ) : result ? (
        <ResultGrid result={result} />
      ) : (
        <p className="font-mono text-sm text-neutral-400">Run a query to see results.</p>
      )}
    </div>
  );
}
