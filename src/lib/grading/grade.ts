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
  /** `probe` is set only for DML grading: it names the state observation that caught the divergence. */
  | { verdict: 'incorrect'; diff: Exclude<CompareResult, { equal: true }>; probe?: string }
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
  /**
   * Post-mutation state observations. Present ⇒ DML grading: `referenceSql` and `learnerSql` are
   * mutations, and it's the state each leaves behind (as seen by these probes) that is compared.
   */
  probes?: { label: string; sql: string }[];
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

/**
 * Restore the grading instance to pristine post-setup state.
 *
 * DISCARD ALL clears session objects (temp tables survive DROP SCHEMA); it must be its own
 * statement, as it can't run inside the reset batch's transaction. DML grading calls this twice
 * per grade — once before the reference mutation, once before the learner's — so each mutation
 * starts from the same base and neither sees the other's writes.
 */
async function resetToPristine(db: Awaited<ReturnType<typeof getGradingDb>>, setupSql?: string) {
  await db.exec('DISCARD ALL');
  await resetDatabase(db as unknown as PGlite);
  if (setupSql && setupSql.trim()) await db.exec(setupSql);
}

async function gradeOnce(input: GradeInput): Promise<GradeResult> {
  const db = await getGradingDb();

  try {
    await resetToPristine(db, input.setupSql);
  } catch (e) {
    return { verdict: 'unavailable', message: `Grading setup failed: ${String(e)}` };
  }

  if (input.probes?.length) return gradeMutation(db, input, input.probes);

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

/**
 * Grade a mutation by comparing the *state* it leaves behind, not its result set.
 *
 * A bare INSERT/UPDATE/DELETE returns no rows, so there is nothing to compare directly. Instead:
 * run the reference mutation on pristine state and capture what the probes see (the oracle), reseed
 * to that same pristine state, run the learner's mutation, re-run the probes, and compare
 * probe-for-probe. The second reseed is what makes this honest — without it the learner would be
 * mutating state the reference had already changed.
 *
 * The learner's own statement result is deliberately ignored: whether they used RETURNING, or ran
 * three statements instead of one, is irrelevant if the resulting state matches.
 */
async function gradeMutation(
  db: Awaited<ReturnType<typeof getGradingDb>>,
  input: GradeInput,
  probes: { label: string; sql: string }[],
): Promise<GradeResult> {
  // Oracle: the reference mutation's effect, as seen by each probe.
  const ref = await executeSql(db, input.referenceSql);
  if (!ref.ok) {
    return { verdict: 'unavailable', message: `Reference mutation failed: ${ref.error.message}` };
  }
  const expected: { label: string; result: typeof ref.result }[] = [];
  for (const probe of probes) {
    const res = await executeSql(db, probe.sql);
    if (!res.ok) {
      return {
        verdict: 'unavailable',
        message: `Probe "${probe.label}" failed after the reference mutation: ${res.error.message}`,
      };
    }
    if (res.result.fields.length === 0) {
      return { verdict: 'unavailable', message: `Probe "${probe.label}" returned no columns (must be a SELECT).` };
    }
    const dup = firstDuplicateColumn(res.result.fields);
    if (dup !== null) {
      return {
        verdict: 'unavailable',
        message: `Probe "${probe.label}" has two columns named "${dup}"; alias them with AS.`,
      };
    }
    expected.push({ label: probe.label, result: res.result });
  }

  // Back to the same starting point, so the learner's mutation is judged from pristine state.
  try {
    await resetToPristine(db, input.setupSql);
  } catch (e) {
    return { verdict: 'unavailable', message: `Grading reset failed: ${String(e)}` };
  }

  const learner = await executeSql(db, input.learnerSql);
  if (!learner.ok) {
    return { verdict: 'error', error: learner.error, sql: learner.sql };
  }

  for (const [i, probe] of probes.entries()) {
    const res = await executeSql(db, probe.sql);
    // A probe that ran against the reference but fails now means the learner's statement left the
    // schema unusable (dropped a column, wrong type) — their fault, reported as their error.
    if (!res.ok) {
      return { verdict: 'error', error: res.error, sql: probe.sql };
    }
    const cmp = compareResults(expected[i].result, res.result, input.compare);
    if (!cmp.equal) return { verdict: 'incorrect', diff: cmp, probe: probe.label };
  }
  return { verdict: 'correct' };
}
