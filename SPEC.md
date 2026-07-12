# SPEC — Lesson & Question Content Model (Task 3.1)

Status: approved via spec interview 2026-07-12. Source of record for the content-model
types. Implements backlog task 3.1 (`feat: define lesson and question content model`).

## Purpose

Define the TypeScript types for lesson/quiz content so that:
- Lesson content (Phase 4) can be authored as typed TS objects with full compile-time safety.
- The quiz flow (3.3) can render every question type in the taxonomy.
- The grader (3.4) can consume a `write-query` question and grade it against the reference,
  driven by the settled grading-isolation model (a reseeded grading instance).

This task ships **types + one validating sample lesson only**. No UI, no grader, no loader.

## Grounding (from the repo, not invented)

- Question-type taxonomy: 11 types — CURRICULUM.md "Question-Type Taxonomy". We model all 11
  as a discriminated union so the set is closed and the compiler enforces each shape.
- Reveal requirement: every reveal carries correct answer + *why* (mechanism) + why each
  distractor is wrong + optional reproducible SQL. CURRICULUM.md "Answer-reveal requirement".
- Cross-cutting theme tags (8): CURRICULUM.md "Cross-Cutting Mastery Themes". Questions may tag
  themes so the app can surface/track them.
- Version gates (e.g. `MERGE` 15+, `JSON_TABLE` 17+, `uuidv7()` 18+): a lesson/question may
  record a `minPgVersion` for awareness (practice instance is pinned to PG18).
- Tier/unit structure: CURRICULUM.md tiers 0–5 + DESIGN.md (design taught first). A lesson has a
  stable `id` and a `unit` reference (e.g. `"1.1"`, `"design.2"`).
- Grading isolation (decided 2026-07-12, TASKS.md log): grading runs on a dedicated instance,
  reset-reseeded per grade (~290ms). So NO `assumesPristine` flag on the learner DB. A lesson
  may carry optional `setupSql` run on the reseeded grading instance before grading (for index/
  perf lessons that need an index or extra rows beyond the base seed).

## Decisions (from the interview)

1. **Question types → discriminated union** on `kind`. Each variant carries only its own fields.
2. **Content authored as typed TS object modules** (`.ts` exporting `Lesson` objects). `teach`
   and prose fields are markdown strings. No parser/loader; direct import of the types.
3. **DB context → optional `setupSql`** per lesson, run on the reseeded grading instance before
   grading. Absent = base seed only.
4. **Write-query comparison → configurable per question.** Default: order-insensitive set
   comparison of canonicalized rows. Per-question `compare.orderMatters` for ORDER BY / window
   lessons; `compare.ignoreColumnNames` when only values matter.

## Type model (shape, not final source)

```ts
// ---- shared ----
type Tier = 0 | 1 | 2 | 3 | 4 | 5 | 'design';
type Theme =
  | 'null-correctness' | 'set-based-thinking' | 'logical-eval-order'
  | 'selectivity-cardinality' | 'concurrency' | 'cost-of-writes'
  | 'read-the-plan' | 'portability';

/** The answer reveal shown after any question (CURRICULUM reveal requirement). */
type Reveal = {
  correct: string;            // the correct answer, stated plainly
  why: string;                // the mechanism — WHY it's correct, not a restatement
  distractors?: string[];     // why each plausible wrong answer is wrong
  reproduceSql?: string;      // SQL the learner can run in the live editor to see it
};

type QuestionBase = {
  id: string;
  prompt: string;             // markdown
  themes?: Theme[];
  minPgVersion?: number;      // e.g. 15, 17, 18 — awareness/version gate
  reveal: Reveal;
};

// ---- the 11 taxonomy kinds as a discriminated union ----
type Question =
  | (QuestionBase & { kind: 'multiple-choice'; choices: string[]; answerIndex: number })
  | (QuestionBase & { kind: 'predict-output'; sql: string; expected: ExpectedResult })
  | (QuestionBase & { kind: 'predict-error'; sql: string; runs: boolean; sqlState?: string })
  | (QuestionBase & { kind: 'spot-the-bug'; sql: string })
  | (QuestionBase & { kind: 'write-query'; referenceSql: string; setupSql?: string; compare?: CompareMode })
  | (QuestionBase & { kind: 'rewrite-optimize'; startingSql: string; referenceSql?: string })
  | (QuestionBase & { kind: 'read-plan'; sql: string; planContext?: string })
  | (QuestionBase & { kind: 'choose-index'; sql: string; choices: string[]; answerIndex: number })
  | (QuestionBase & { kind: 'concurrency'; steps: string[] })      // interleaved-txn narrative
  | (QuestionBase & { kind: 'explain-mechanism'; }) // "why is the answer what it is" — reveal-driven
  | (QuestionBase & { kind: 'compare-approaches'; options: string[] });

type ExpectedResult = { columns?: string[]; rows: unknown[][] };  // for predict-output

type CompareMode = {
  orderMatters?: boolean;      // default false (unordered set of rows)
  ignoreColumnNames?: boolean; // default false (column names must match)
};

// ---- lesson ----
type Lesson = {
  id: string;                  // stable, e.g. 'tier1.select'
  unit: string;                // curriculum unit, e.g. '1.1' or 'design.2'
  tier: Tier;
  title: string;
  teach: string;               // markdown teach content
  exampleSql?: string;         // worked example preloaded into the editor
  setupSql?: string;           // run on reseeded grading instance before grading this lesson's Qs
  questions: Question[];
};
```

Notes:
- The union is closed at 11 to match the taxonomy exactly; adding a 12th taxonomy entry means
  adding a variant here (a deliberate, compiler-enforced change).
- `write-query` carries its own `setupSql` too (question-level override of the lesson default),
  and `compare` for the ORDER-BY case.
- `ExpectedResult.rows` is `unknown[][]` (row-major) — the grader/quiz canonicalizes values;
  the schema doesn't over-commit to a value type before 3.4 measures how PGlite returns numerics.

## Verification (task 3.1 done-criteria)

- `npx tsc --noEmit` passes with the new types.
- One sample `Lesson` object (a real Tier-1 lesson, e.g. 1.1 SELECT, with a `write-query` and a
  `multiple-choice` question) is authored and **type-checks** — proving the shape is usable.
- A tiny `node:test` asserts the sample validates structurally (kinds present, reveal fields set),
  matching this repo's test convention (transpile-with-tsc, zero new deps).

## Out of scope (later tasks)

- Rendering (3.2 lesson view, 3.3 quiz flow).
- The grader + result-set comparison implementation (3.4) and the `executeSql` extraction (HIGH-1).
- Progress tracking (4.2), navigation (4.1), authoring real lesson clusters (4.3/4.4).
```
