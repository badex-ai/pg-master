'use client';

import { useCallback, useRef, useState } from 'react';
import type { PGliteInterface } from '@electric-sql/pglite';
import type { QueryResult } from '@/components/ResultGrid';
import { toPgError, type PgError } from '@/lib/pgError';

/** A failed run: the parsed Postgres error plus the query that produced it (for the caret). */
export type RunFailure = { error: PgError; query: string };

/** A successful run: the result of the LAST statement in the batch, and how long it took. */
export type RunOutcome = { result: QueryResult; elapsedMs: number };

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
 * while another is in flight).
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
      const gen = (generation.current += 1);
      setRunning(true);
      const start = performance.now();
      try {
        const results = await db.exec(trimmed);
        if (gen !== generation.current) return; // a newer run supersedes this one
        const elapsedMs = performance.now() - start;
        // The last statement's result is what the learner sees (mirrors psql).
        const last = results[results.length - 1];
        setOutcome({
          result: {
            rows: (last?.rows ?? []) as Record<string, unknown>[],
            fields: last?.fields ?? [],
            affectedRows: last?.affectedRows,
          },
          elapsedMs,
        });
        setFailure(null);
      } catch (e) {
        if (gen !== generation.current) return;
        setFailure({ error: toPgError(e), query: trimmed });
        setOutcome(null);
      } finally {
        if (gen === generation.current) setRunning(false);
      }
    },
    [db],
  );

  return { outcome, failure, running, run, clear };
}
