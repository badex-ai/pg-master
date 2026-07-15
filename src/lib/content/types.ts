/**
 * The lesson & question content model.
 *
 * Lessons are authored as typed TS objects (see `content/**`), so the whole curriculum is
 * compile-time checked — a malformed question is a build error, not a runtime surprise. The
 * quiz flow (3.3) renders these; the grader (3.4) consumes a `write-query` question and grades
 * it against a freshly-reseeded grading instance (per the grading-isolation decision).
 *
 * The question set is a closed discriminated union of exactly the 11 taxonomy kinds in
 * CURRICULUM.md. Adding a 12th kind to the curriculum means adding a variant here — a
 * deliberate, compiler-enforced change, never an untyped escape hatch.
 */

/** Curriculum tier. `'design'` is the design-first track (DESIGN.md), taught before Tier 0. */
export type Tier = 0 | 1 | 2 | 3 | 4 | 5 | 'design';

/** The 8 cross-cutting mastery themes (CURRICULUM.md). Questions tag the ones they exercise. */
export type Theme =
  | 'null-correctness'
  | 'set-based-thinking'
  | 'logical-eval-order'
  | 'selectivity-cardinality'
  | 'concurrency'
  | 'cost-of-writes'
  | 'read-the-plan'
  | 'portability';

/**
 * The reveal shown after a question is answered. Per CURRICULUM.md's answer-reveal requirement,
 * a reveal must give the correct answer, the *mechanism* (why it's correct — not a restatement),
 * why plausible wrong answers are wrong, and — where it helps — SQL the learner can run live.
 */
export type Reveal = {
  /** The correct answer, stated plainly. */
  correct: string;
  /** WHY it is correct: the underlying Postgres mechanism, not a restatement of `correct`. */
  why: string;
  /** Why each plausible distractor is wrong (parallel to a question's wrong choices). */
  distractors?: string[];
  /** SQL the learner can paste into the live editor to reproduce the result/plan. */
  reproduceSql?: string;
};

/**
 * A seed fact a question's prose or answer depends on, checked against the live database.
 *
 * Prompts, choices and reveals make claims about the seeded data ("users has 10 rows, one with a
 * NULL full_name"; a multiple-choice answer of '9'). Those claims are unverifiable by the runtime
 * test on their own — a static test can only pin what the author wrote, not whether it is true —
 * so a seed change silently turns a correct answer into a wrong one. Each entry re-derives the
 * fact from the database: `sql` must return exactly one row and one column equal to `equals`.
 *
 * Author rule: every number, id, or row-fact stated in a prompt, choice or reveal gets an entry.
 * Cast to text in the SQL (`count(*)::text`) so the expectation is an unambiguous string.
 *
 * Two traps the comparison cannot express for you:
 *  - **NULL is not assertable** via `equals` — a NULL result is compared as JS `null` and matches
 *    no string, `'null'` included. Phrase the fact as a boolean or a count instead
 *    (`(x IS NULL)::text` → `'true'`, or `count(*) FILTER (WHERE x IS NULL)::text`).
 *  - **Values are stringified naively**, unlike the grading comparator's type-aware canonicalizer.
 *    A bare jsonb or timestamptz column will not render how you expect. Assert through an
 *    explicit cast or an expression that yields a stable scalar. The test session is pinned to
 *    UTC, so `timestamptz::text` is deterministic — but it still prints an offset (`+00`).
 */
export type SeedFact = {
  /** Single-row, single-column SELECT re-deriving the claimed fact from the seed. */
  sql: string;
  /** The expected value, as text. Cannot express NULL — assert a boolean or count instead. */
  equals: string;
};

/** Fields common to every question, regardless of kind. */
export type QuestionBase = {
  /** Stable id, unique within a lesson (e.g. 'q1'). */
  id: string;
  /** The question prompt (markdown). */
  prompt: string;
  /** Cross-cutting themes this question exercises. */
  themes?: Theme[];
  /** Minimum PG major version for the feature under test (e.g. 15, 17, 18). Awareness/gate. */
  minPgVersion?: number;
  /** Seed facts this question's prose or answer depends on. Checked against a live reseed. */
  verify?: SeedFact[];
  /** The post-answer reveal. */
  reveal: Reveal;
};

/** Row-major expected result for a predict-output question. Values are canonicalized at grade time. */
export type ExpectedResult = {
  /** Expected column names, in order (optional — some questions only assert values). */
  columns?: string[];
  /** Expected rows, row-major. `unknown` because value types are canonicalized by the grader. */
  rows: unknown[][];
};

/**
 * How a write-query answer's result set is compared to the reference's. Default (no object):
 * an order-insensitive comparison of canonicalized rows with matching column names.
 */
export type CompareMode = {
  /** Require rows in the same order (ORDER BY / window lessons where order IS the answer). */
  orderMatters?: boolean;
  /** Compare values only, ignoring column names (when the requirement doesn't fix names). */
  ignoreColumnNames?: boolean;
};

/**
 * A single quiz question — a discriminated union over the 11 taxonomy kinds. Each variant
 * carries only the fields its kind needs, so the renderer and grader `switch (q.kind)` with
 * full type narrowing.
 */
export type Question =
  // 1. Predict-the-output — exact returned rows (order, NULLs, duplicates).
  | (QuestionBase & { kind: 'predict-output'; sql: string; expected: ExpectedResult })
  // 2. Predict-the-error — does it run? if not, which error.
  | (QuestionBase & { kind: 'predict-error'; sql: string; runs: boolean; sqlState?: string })
  // 3. Spot-the-bug — runs but returns wrong results; learner identifies the defect.
  | (QuestionBase & { kind: 'spot-the-bug'; sql: string })
  // 4. Write-the-query — graded by running against the DB and comparing result sets.
  | (QuestionBase & {
      kind: 'write-query';
      /** The canonical correct query; its result set is the grading oracle. */
      referenceSql: string;
      /** Extra setup on the reseeded grading instance for this question (overrides the lesson's). */
      setupSql?: string;
      /** Result-set comparison mode; omitted = unordered set, names must match. */
      compare?: CompareMode;
    })
  // 5. Rewrite/optimize — make it correct/faster and explain the change.
  | (QuestionBase & { kind: 'rewrite-optimize'; startingSql: string; referenceSql?: string })
  // 6. Read-the-plan — given EXPLAIN output, name the bottleneck and fix.
  | (QuestionBase & { kind: 'read-plan'; sql: string; planContext?: string })
  // 7. Choose-the-index — which index makes this fast, and why that column order.
  | (QuestionBase & { kind: 'choose-index'; sql: string; choices: string[]; answerIndex: number })
  // 8. Concurrency scenario — two interleaved transactions as an ordered narrative.
  | (QuestionBase & { kind: 'concurrency'; steps: string[] })
  // 9. Why-is-the-answer-what-it-is — mechanism explanation, driven entirely by the reveal.
  | (QuestionBase & { kind: 'explain-mechanism' })
  // 10. Compare-approaches — EXISTS vs IN vs JOIN, CTE vs subquery, with tradeoffs.
  | (QuestionBase & { kind: 'compare-approaches'; options: string[] })
  // 11. Multiple-choice — a plain single-select (used across many units, incl. trap questions).
  | (QuestionBase & { kind: 'multiple-choice'; choices: string[]; answerIndex: number });

/** The `kind` tag values, for exhaustive iteration/validation. */
export type QuestionKind = Question['kind'];

/**
 * A lesson unit: teach content, a worked example, optional DB setup, and its questions.
 * Grading always runs against a reseeded grading instance; `setupSql` (if present) runs on that
 * instance before grading — the only way a lesson departs from the base seed (e.g. add an index
 * for a 'choose-index'/'read-plan' lesson). There is no per-lesson "assumes pristine" flag: the
 * reseed makes pristine the default.
 */
export type Lesson = {
  /** Stable content id (e.g. 'tier1.select'). */
  id: string;
  /** Curriculum unit reference (e.g. '1.1', 'design.2'). */
  unit: string;
  tier: Tier;
  title: string;
  /** Teach content (markdown). */
  teach: string;
  /** Worked example SQL, preloaded into the live editor for this lesson. */
  exampleSql?: string;
  /** SQL run on the reseeded grading instance before grading this lesson's questions. */
  setupSql?: string;
  questions: Question[];
};
