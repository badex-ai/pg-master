import type { PGlite } from '@electric-sql/pglite';
import { resetDatabase } from '../db/seed';
import { executeSql } from '../executeSql';
import type { PgError } from '../pgError';
import { compareResults, type CompareResult, type CompareOptions } from './compare';
import { getGradingDb } from './instance';

/**
 * Grade a write-query answer by running the learner's SQL and the reference against a pristine,
 * reseeded grading instance and comparing result sets.
 *
 * Verdicts:
 *  - `correct` / `incorrect` (with a diff) — the learner's answer, judged against the reference.
 *  - `error` — the learner's SQL raised a Postgres error (their fault; show the error).
 *  - `unavailable` — setup or the reference failed, i.e. a content bug, never the learner's fault.
 */
export type GradeResult =
  | { verdict: 'correct' }
  | { verdict: 'incorrect'; diff: Exclude<CompareResult, { equal: true }> }
  | { verdict: 'error'; error: PgError; sql: string }
  | { verdict: 'ambiguous-columns'; duplicate: string }
  | { verdict: 'unavailable'; message: string };

/**
 * The first output column name that appears more than once, or null. Duplicate names (e.g. an
 * unaliased `SELECT o.id, u.id FROM …`) collapse to one key in PGlite's object-shaped rows, so a
 * value is silently lost before comparison. We detect it up front instead of grading corrupt rows.
 */
function firstDuplicateColumn(fields: { name: string }[]): string | null {
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.name)) return f.name;
    seen.add(f.name);
  }
  return null;
}

export type GradeInput = {
  referenceSql: string;
  learnerSql: string;
  /** Extra setup run on the reseeded instance before grading; question overrides lesson. */
  setupSql?: string;
  compare?: CompareOptions;
};

// Serialize grades: the grading instance is shared, and reset/setup/run must not interleave
// across concurrent grades (two cards, or a double-click). A promise-chain mutex is enough.
let queue: Promise<unknown> = Promise.resolve();

export function grade(input: GradeInput): Promise<GradeResult> {
  const run = () => gradeOnce(input);
  const result = queue.then(run, run); // run even if a prior grade rejected
  // Keep the chain alive but swallow this grade's outcome for the *next* waiter.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function gradeOnce(input: GradeInput): Promise<GradeResult> {
  const db = await getGradingDb();

  // Pristine state: clear session objects (temp tables survive DROP SCHEMA), then reseed.
  // DISCARD ALL must be its own statement — it can't run inside the reset batch's transaction.
  try {
    await db.exec('DISCARD ALL');
    await resetDatabase(db as unknown as PGlite);
    if (input.setupSql && input.setupSql.trim()) await db.exec(input.setupSql);
  } catch (e) {
    return { verdict: 'unavailable', message: `Grading setup failed: ${String(e)}` };
  }

  // Reference runs FIRST on pristine post-setup state — it's the oracle. Running the learner
  // first would let a mutating answer corrupt the state the reference then sees (a false pass).
  const ref = await executeSql(db, input.referenceSql);
  if (!ref.ok) {
    return { verdict: 'unavailable', message: `Reference query failed: ${ref.error.message}` };
  }
  if (ref.result.fields.length === 0) {
    return { verdict: 'unavailable', message: 'Reference query returned no columns (must be a SELECT).' };
  }
  // A duplicate name in the reference is a content bug: object-shaped rows collapse it, so we
  // can't compare honestly. Fail closed as unavailable rather than grade against corrupt rows.
  const refDup = firstDuplicateColumn(ref.result.fields);
  if (refDup !== null) {
    return {
      verdict: 'unavailable',
      message: `Reference query has two columns named "${refDup}"; alias them with AS so each output name is unique.`,
    };
  }

  // Learner runs second. A mutating learner answer only affects state after both its own result
  // and the oracle are fixed; the next grade reseeds anyway.
  const learner = await executeSql(db, input.learnerSql);
  if (!learner.ok) {
    return { verdict: 'error', error: learner.error, sql: learner.sql };
  }
  // A duplicate name in the learner's output collapses a value before comparison, which would
  // mis-grade. It's the learner's to fix (add AS), so tell them rather than judging corrupt rows.
  const learnerDup = firstDuplicateColumn(learner.result.fields);
  if (learnerDup !== null) {
    return { verdict: 'ambiguous-columns', duplicate: learnerDup };
  }

  const cmp = compareResults(ref.result, learner.result, input.compare);
  if (cmp.equal) return { verdict: 'correct' };
  return { verdict: 'incorrect', diff: cmp };
}
