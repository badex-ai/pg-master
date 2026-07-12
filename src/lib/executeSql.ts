import type { PGliteInterface } from '@electric-sql/pglite';
import { toPgError, type PgError } from './pgError';
import { isExplain, toJsonExplain, parseExplainResult, type ExplainPlan } from './explain';

/**
 * Pure SQL execution — no React, no UI state. The one place that runs a learner's SQL, so the
 * interactive console (via useQueryRunner) and the grader (against a pristine instance) share
 * identical semantics: same EXPLAIN handling, same last-statement-wins rule, same error-caret
 * remapping. If they diverged, an answer could grade differently than it runs.
 *
 * Relative imports only (no `@/components/...`) so the module — and its tests — transpile
 * standalone with the repo's headless tsc pattern.
 */

/** Shape of a PGlite query result (the subset the grid and grader need). */
export type QueryResult = {
  rows: Record<string, unknown>[];
  fields: { name: string; dataTypeID: number }[];
  affectedRows?: number;
};

/** A run that produced a result. `sql` is the LEARNER's original text; `plan` set for EXPLAIN. */
export type ExecSuccess = {
  ok: true;
  result: QueryResult;
  elapsedMs: number;
  sql: string;
  plan: ExplainPlan | null;
};

/** A run that raised a Postgres error, with the position mapped back onto the original SQL. */
export type ExecFailure = { ok: false; error: PgError; sql: string };

export type ExecOutcome = ExecSuccess | ExecFailure;

/**
 * Execute a (possibly multi-statement) SQL batch and return a discriminated outcome.
 *
 * Uses `db.exec` so batches (`CREATE ...; INSERT ...;`) work like psql — `db.query` rejects
 * those with a protocol error. The last statement's result is what's returned (mirrors psql).
 * An EXPLAIN is transparently re-run as FORMAT JSON so a plan tree can be built; the plan is
 * identical, only the serialization differs, and any error position is shifted back onto the
 * SQL the learner actually typed.
 *
 * Callers guard empty input; a whitespace-only `sql` still runs (Postgres returns no rows).
 */
export async function executeSql(db: PGliteInterface, sql: string): Promise<ExecOutcome> {
  const trimmed = sql.trim();
  // For an EXPLAIN, run FORMAT JSON under the hood. `positionDelta`/`bodyStart` let us map a
  // Postgres error position back onto the SQL the learner typed.
  const explaining = isExplain(trimmed);
  const { sql: executed, positionDelta, bodyStart } = explaining
    ? toJsonExplain(trimmed)
    : { sql: trimmed, positionDelta: 0, bodyStart: 0 };

  const start = performance.now();
  try {
    const results = await db.exec(executed);
    const elapsedMs = performance.now() - start;
    // The last statement's result is what the learner sees (mirrors psql).
    const last = results[results.length - 1];
    const rows = (last?.rows ?? []) as Record<string, unknown>[];
    return {
      ok: true,
      result: { rows, fields: last?.fields ?? [], affectedRows: last?.affectedRows },
      elapsedMs,
      sql: trimmed,
      plan: explaining ? parseExplainResult(rows) : null,
    };
  } catch (e) {
    const error = toPgError(e);
    // The error position points into the executed (rewritten) text. Shift it back onto the
    // learner's original SQL — but ONLY for an error in the statement body (at or after
    // `bodyStart`), where the shift is a uniform `positionDelta`. An error inside the option
    // list we injected has no 1:1 mapping back, so drop the caret rather than mispoint it.
    if (error.position !== undefined && positionDelta !== 0) {
      error.position = error.position >= bodyStart ? error.position - positionDelta : undefined;
    }
    return { ok: false, error, sql: trimmed };
  }
}
