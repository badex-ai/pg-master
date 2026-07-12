'use client';

import { useCallback, useRef, useState } from 'react';
import type { PGliteInterface } from '@electric-sql/pglite';
import type { PgError } from '@/lib/pgError';
import { executeSql, type QueryResult } from '@/lib/executeSql';
import type { ExplainPlan } from '@/lib/explain';

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
 * The interactive SQL run state machine: a thin React shell over the pure `executeSql`, which
 * does the actual work (EXPLAIN handling, last-statement rule, error-caret remap). This shell
 * adds only what UI needs — a `running` flag and a generation counter so overlapping runs are
 * safe: only the latest run may write state, so a slow failing run can never stomp a newer
 * successful one (the editor's Cmd+Enter can start a run while another is in flight).
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
      if (!sql.trim()) return;
      const gen = (generation.current += 1);
      setRunning(true);
      const res = await executeSql(db, sql);
      if (gen !== generation.current) return; // a newer run supersedes this one
      if (res.ok) {
        setOutcome({ result: res.result, elapsedMs: res.elapsedMs, sql: res.sql, plan: res.plan });
        setFailure(null);
      } else {
        setFailure({ error: res.error, query: res.sql });
        setOutcome(null);
      }
      setRunning(false);
    },
    [db],
  );

  return { outcome, failure, running, run, clear };
}
