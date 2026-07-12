'use client';

import { useCallback, useRef, useState } from 'react';
import type { PGliteInterface } from '@electric-sql/pglite';
import type { QueryResult } from '@/components/ResultGrid';
import { toPgError, type PgError } from '@/lib/pgError';
import { isExplain, toJsonExplain, parseExplainResult, type ExplainPlan } from '@/lib/explain';

/**
 * A failed run: the parsed Postgres error and the query the LEARNER typed. For an EXPLAIN
 * that ran as FORMAT JSON under the hood, the error position is mapped back onto the
 * original text, so the caret points at the SQL on screen — not the rewritten query.
 */
export type RunFailure = { error: PgError; query: string };

/**
 * A successful run: the last statement's result, elapsed time, the SQL the learner typed,
 * and — when it was an EXPLAIN — the parsed plan tree. Lessons/graders consume this same
 * shape, so the plan and the original SQL travel with the outcome, not a UI-only flag.
 */
export type RunOutcome = { result: QueryResult; elapsedMs: number; sql: string; plan: ExplainPlan | null };

export type QueryRunner = {
  outcome: RunOutcome | null;
  failure: RunFailure | null;
  running: boolean;
  /** Execute a (possibly multi-statement) SQL batch. Resolves after state settles. */
  run: (sql: string) => Promise<void>;
  /** Discard the current result/error without running anything (e.g. after a reset). */
  clear: () => void;
};

/**
 * The SQL run state machine, independent of any editor UI so a lesson can drive runs
 * programmatically and a grader can reuse it against a pristine instance.
 *
 * Uses `db.exec` so multi-statement batches (`CREATE ...; INSERT ...;`) work like they
 * would in psql — `db.query` rejects those with a protocol error. A generation counter
 * makes overlapping runs safe: only the latest run may write state, so a slow failing
 * run can never stomp a newer successful one (the editor's Cmd+Enter can start a run
 * while another is in flight). EXPLAIN is handled here (not in the UI) so every caller —
 * including a lesson driving runs directly — gets the plan and the original-SQL mapping.
 */
export function useQueryRunner(db: PGliteInterface): QueryRunner {
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [failure, setFailure] = useState<RunFailure | null>(null);
  const [running, setRunning] = useState(false);
  const generation = useRef(0);

  const clear = useCallback(() => {
    generation.current += 1; // invalidate any in-flight run
    setOutcome(null);
    setFailure(null);
    setRunning(false);
  }, []);

  const run = useCallback(
    async (sql: string) => {
      const trimmed = sql.trim();
      if (!trimmed) return;
      // For an EXPLAIN, run FORMAT JSON under the hood so we can render a plan tree; the
      // plan is identical, only the serialization differs. `positionDelta`/`bodyStart` let
      // us map a Postgres error position back onto the SQL the learner typed.
      const explaining = isExplain(trimmed);
      const { sql: executed, positionDelta, bodyStart } = explaining
        ? toJsonExplain(trimmed)
        : { sql: trimmed, positionDelta: 0, bodyStart: 0 };

      const gen = (generation.current += 1);
      setRunning(true);
      const start = performance.now();
      try {
        const results = await db.exec(executed);
        if (gen !== generation.current) return; // a newer run supersedes this one
        const elapsedMs = performance.now() - start;
        // The last statement's result is what the learner sees (mirrors psql).
        const last = results[results.length - 1];
        const rows = (last?.rows ?? []) as Record<string, unknown>[];
        setOutcome({
          result: { rows, fields: last?.fields ?? [], affectedRows: last?.affectedRows },
          elapsedMs,
          sql: trimmed,
          plan: explaining ? parseExplainResult(rows) : null,
        });
        setFailure(null);
      } catch (e) {
        if (gen !== generation.current) return;
        const error = toPgError(e);
        // The error position points into the executed (rewritten) text. Shift it back onto
        // the learner's original SQL — but ONLY for an error in the statement body (at or
        // after `bodyStart`), where the shift is a uniform `positionDelta`. An error inside
        // the option list we injected has no 1:1 mapping back (we spliced in `, FORMAT JSON`
        // and, in the legacy path, collapsed whitespace), so drop the caret rather than
        // point it at the wrong token.
        if (error.position !== undefined && positionDelta !== 0) {
          error.position =
            error.position >= bodyStart ? error.position - positionDelta : undefined;
        }
        setFailure({ error, query: trimmed });
        setOutcome(null);
      } finally {
        if (gen === generation.current) setRunning(false);
      }
    },
    [db],
  );

  return { outcome, failure, running, run, clear };
}
