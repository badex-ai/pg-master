'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePGlite } from '@electric-sql/pglite-react';
import { useResetDatabase, useResetEpoch } from '@/lib/db/provider';
import { SqlEditor, DEFAULT_SCHEMA, type EditorSchema } from './SqlEditor';
import { ResultGrid } from './ResultGrid';
import { QueryError } from './QueryError';
import { ExplainPlanView } from './ExplainPlan';
import { useQueryRunner, type RunFailure, type RunOutcome } from '@/lib/useQueryRunner';

const DEFAULT_INITIAL_SQL = 'SELECT * FROM users;';

type QueryConsoleProps = {
  /** SQL to preload into the editor (e.g. a lesson's worked example). */
  initialSql?: string;
  /** Notified after each run settles, so a lesson can react to (or grade) the result. */
  onRunComplete?: (result: RunOutcome | RunFailure) => void;
  /** Notified on every edit with the current SQL, so a grader can read the answer text. */
  onSqlChange?: (sql: string) => void;
};

/**
 * The core practice surface: a SQL editor wired to the in-browser Postgres, with the
 * result rendered in a DB-client-style grid. Owns the SQL text; the run state machine
 * lives in useQueryRunner so a lesson could reuse it. Keeps autocomplete honest by
 * refreshing the editor schema from information_schema after each run.
 */
export function QueryConsole({ initialSql = DEFAULT_INITIAL_SQL, onRunComplete, onSqlChange }: QueryConsoleProps) {
  const db = usePGlite();
  const reset = useResetDatabase();
  const resetEpoch = useResetEpoch();
  const runner = useQueryRunner(db);

  const [sql, setSql] = useState(initialSql);

  // Mirror edits to the current SQL out to a grader, while keeping local editor state.
  const handleSqlChange = useCallback(
    (next: string) => {
      setSql(next);
      onSqlChange?.(next);
    },
    [onSqlChange],
  );
  const [schema, setSchema] = useState<EditorSchema>(DEFAULT_SCHEMA);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshSchema = useCallback(async () => {
    const res = await db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    );
    const next: EditorSchema = {};
    for (const { table_name, column_name } of res.rows) {
      (next[table_name] ??= []).push(column_name);
    }
    // Only replace when the schema actually changed, so autocomplete (and thus the
    // CodeMirror extensions) don't reconfigure on every successful run.
    setSchema((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [db]);

  const run = useCallback(
    async (query: string) => {
      setNotice(null);
      // The runner detects EXPLAIN, runs it as FORMAT JSON, and returns the plan on the
      // outcome — no EXPLAIN logic lives here.
      await runner.run(query);
      // A statement may have changed the schema; keep autocomplete current. Runs after
      // the user query settles, and never masks a query outcome (its own failure is
      // swallowed — a broken information_schema read is not the learner's error).
      refreshSchema().catch(() => {});
    },
    [runner, refreshSchema],
  );

  // Report each settled run to a parent lesson, if any.
  const lastSettled = runner.failure ?? runner.outcome;
  useEffect(() => {
    if (lastSettled && onRunComplete) onRunComplete(lastSettled);
  }, [lastSettled, onRunComplete]);

  // A reset replaces the whole database. Do NOT re-run the editor's SQL — it may be
  // destructive (DELETE/DROP), which would wipe the freshly restored data. Clear the
  // last result and tell the learner the sample data is back.
  useEffect(() => {
    if (resetEpoch > 0) {
      runner.clear();
      setNotice('Database reset — sample data restored.');
      refreshSchema().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetEpoch]);

  const handleReset = useCallback(async () => {
    await reset();
  }, [reset]);

  const { outcome, failure, running } = runner;
  // An EXPLAIN outcome carries its parsed plan; render it as a tree instead of a grid.
  const plan = outcome?.plan ?? null;

  return (
    <div className="flex flex-col gap-3">
      <SqlEditor value={sql} onChange={handleSqlChange} onRun={run} schema={schema} />

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

      {failure ? (
        <QueryError error={failure.error} query={failure.query} />
      ) : plan ? (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-xs text-neutral-400">
            query plan{' · '}
            {outcome && outcome.elapsedMs < 1
              ? '<1 ms'
              : `${outcome?.elapsedMs.toFixed(outcome.elapsedMs < 10 ? 1 : 0)} ms`}
          </p>
          <ExplainPlanView plan={plan} />
        </div>
      ) : outcome ? (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-xs text-neutral-400">
            {outcome.result.fields.length > 0
              ? `${outcome.result.rows.length} row${outcome.result.rows.length === 1 ? '' : 's'}`
              : `${outcome.result.affectedRows ?? 0} row${(outcome.result.affectedRows ?? 0) === 1 ? '' : 's'} affected`}
            {' · '}
            {outcome.elapsedMs < 1
              ? '<1 ms'
              : `${outcome.elapsedMs.toFixed(outcome.elapsedMs < 10 ? 1 : 0)} ms`}
          </p>
          {outcome.result.fields.length > 0 && <ResultGrid result={outcome.result} />}
        </div>
      ) : notice ? (
        <p className="font-mono text-sm text-emerald-600">{notice}</p>
      ) : (
        <p className="font-mono text-sm text-neutral-400">Run a query to see results.</p>
      )}
    </div>
  );
}
