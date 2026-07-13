# Build Backlog — PG Master

> **How this file works (the Ralph-loop contract).** This is the durable, ordered task
> list. Each task is small, independently shippable, and produces **one commit**. Work
> **top to bottom**, one unchecked task at a time. When a task is done: verify it, check its
> box, commit with the stated Conventional-Commit message, then move to the next. This file
> is the single source of truth for "what's next" — re-read it at the start of every
> iteration.
>
> **Commit rule:** Conventional Commits.
> **Verify rule:** every task states how to prove it works; don't check the box until it does.
>
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

---

## Phase 0 — Repo & foundations

- [x] **0.1** Init git repo, `.gitignore`, `README.md`, this `TASKS.md`.
      _Commit:_ `chore: initialise repo with specs and build backlog`
- [x] **0.2** Scaffold Next.js + TS + Tailwind app (App Router). Configure `transpilePackages`
      for PGlite. App boots to a placeholder home page.
      _Verify:_ `npm run build` compiles successfully, types check, static pages generate.
      (Next pinned to 15.5.20 — 15.1.6 had critical CVE-2025-66478.)
      _Commit:_ `feat: scaffold next.js app with tailwind and pglite config`
- [x] **0.3** Add PGlite + pglite-react deps and a client-only `PGliteProvider` at the root.
      A tiny debug component runs `SELECT version()` and renders the result.
      _Verify:_ build passes; PGlite boots headlessly and returns `PostgreSQL 18.3 (PGlite
      0.5.4)` — confirming real PG18, matching the pinned content version. (Browser render
      to be eyeballed by user via `npm run dev`.)
      _Commit:_ `feat: wire up pglite provider with a version smoke test`

## Phase 1 — The data layer (from DATASET.md)

- [x] **1.1** Write the schema DDL for the e-commerce dataset (all 8 tables + bookings) as a
      seed SQL module, exactly matching [[DATASET.md]] (types, constraints, keys).
      _Verify:_ ran in PGlite — all 10 tables created, EXCLUDE constraint present,
      users.email is citext. citext + btree_gist loaded as PGlite extension modules in the
      provider (not `CREATE EXTENSION` alone). Build passes.
      _Commit:_ `feat: add e-commerce schema ddl matching the dataset spec`
- [x] **1.2** Write the seed INSERTs for the curated 10 rows per table (the exact edge-case
      rows from [[DATASET.md]]).
      _Verify:_ ran schema+seed in PGlite — all 10 tables have exactly 10 rows; NULL user_id
      order 105, order-101 fan-out (2 items × 3 shipments), refund, NULL-body review,
      zero-stock, NULL category all present; citext + EXCLUDE still enforced against seeded
      data. Inserts use OVERRIDING SYSTEM VALUE (identity ids are meaningful FK targets); a
      SEQUENCE_FIXUP advances each identity sequence past the seeded max (next user id = 11).
      _Commit:_ `feat: seed curated 10-row sample data`
- [x] **1.3** On PGlite init, run schema + seed once (idempotent). Add a "reset database"
      action that re-seeds.
      _Verify:_ headless — seed is idempotent (second call no-ops), reset restores curated
      state after edits, sequence fixup survives reset, double-reset safe. In-browser
      (Playwright) — provider seeds on init (reviews=10), delete→0, reset→10, fresh load
      has 0 console errors. resetDatabase drops (reverse-dep order) + rebuilds; exposed via
      a ResetContext / useResetDatabase hook.
      _Commit:_ `feat: auto-seed pglite on init with a reset action`

## Phase 2 — The SQL editor & result grid (the core surface)

- [x] **2.1** Add a CodeMirror SQL editor component (SQL syntax highlighting, run on
      Cmd/Ctrl+Enter).
      _Verify:_ in-browser (Playwright) — editor renders with line numbers; typed SQL is
      syntax-highlighted (keywords carry CM6 token classes); Ctrl+Enter fires the run handler
      (Runs 0→1→2) and the handler receives the live document text, not the stale preload;
      console clean. Uses @uiw/react-codemirror + @codemirror/lang-sql (PostgreSQL dialect,
      schema-aware autocomplete). Controlled value/onChange so the parent can preload examples.
      _Deep review (Fable):_ found + fixed a HIGH defect — `extensions` memoized on `onRun`
      identity reconfigured the editor every keystroke (tearing down autocomplete mid-typing);
      fixed with a latest-ref for `onRun` + build-extensions-once. Also: aria-label now set via
      `EditorView.contentAttributes` (reaches the real textbox); keymap/Prec/EditorView imported
      from the wrapper (single-instance guarantee). Verified in-browser: autocomplete persists
      across keystrokes (`reviews` completes first), run handler still fires, aria-label on the
      textbox. Tag NOT moved — end-of-Phase-2 milestone still covers this.
      _Commit:_ `feat: add codemirror sql editor` (+ `fix: build editor extensions once ...`)
- [x] **2.2** Execute editor SQL against PGlite; render results in a DB-client-style grid
      (monospace, zebra rows, right-aligned numbers, explicit NULL chips per [[DATASET.md]]).
      _Verify:_ in-browser (Playwright) — `SELECT * FROM users` shows 10 rows with 3 NULL chips
      (rows 4+8), numeric `id` right-aligned, jsonb as compact JSON; a DELETE shows "2 rows
      affected"; Reset auto-re-runs the current query (8→10 reviews) via resetEpoch; live-schema
      autocomplete picks up a learner-created `widgets` table; Run button + Cmd/Ctrl+Enter both
      work; console clean. Deleted the VersionSmokeTest + EditorSmokeTest harnesses. Resolved
      deep-review notes: (2) resetEpoch invalidation, (3) live schema from information_schema,
      (4) visible Run button, (5) cells render as text nodes only. Error display is minimal
      here (proper SQLSTATE/timing is task 2.3).
      _Note (from deep review):_ (1) delete the temporary `VersionSmokeTest` AND
      `EditorSmokeTest` components here — the real editor/grid replaces them; keep
      `useResetDatabase`, the provider, and `SqlEditor`. (2) A learner-facing reset mutates
      the world under every result view; add a `resetEpoch` counter to the DB context
      (incremented on reset) and key result fetches on it so the grid/sample panel refetch
      after a reset. Designing this now is one integer; retrofitting after several components
      hold state is a refactor. (3) Make `SqlEditor`'s `schema` a prop, defaulted to the
      current constant, and refresh it from `information_schema.columns` after each successful
      run — the hardcoded map goes stale the moment a learner runs DDL (this app teaches
      schema design). (4) Ship a visible Run button (same handler) with the Cmd/Ctrl+Enter
      shortcut as its label/tooltip — a keyboard-only trigger is undiscoverable. (5) Result
      grid cells hold arbitrary query output; render as React text nodes only, never raw HTML.
      _Commit:_ `feat: run queries and render results in a db-style grid`
- [x] **2.3** Handle errors like real Postgres: show the SQLSTATE + message on a bad query,
      not a crash. Show rows-affected / timing for DML.
      _Verify:_ in-browser (Playwright) — `SELECT * FORM users` renders `ERROR: syntax error
      at or near "FORM"` with a caret under FORM (LINE 1) and SQLSTATE 42601; a duplicate
      `ADA@example.com` insert renders `ERROR: duplicate key ...` + DETAIL + SQLSTATE 23505
      (also demonstrates citext case-insensitivity live); a successful query shows
      "7 rows · 6.1 ms"; DML shows "N rows affected · time"; console clean (errors render
      in-UI, not as crashes). PGlite error narrowed structurally (class name is minified);
      caret uses the error `position` offset. _Note:_ pure pgError.ts logic is currently
      guarded only by the browser test (Node v20 can't strip TS types for a unit test) —
      candidate for a unit test if Vitest is added later.
      _Commit:_ `feat: surface postgres errors and query timing`
      _Deep review (Fable, Phase-2 delta 2.1–2.3):_ found + fixed — CRITICAL: reset was
      re-running the editor's SQL via resetEpoch, so DELETE-then-Reset re-deleted the
      restored data; now Reset clears results + shows a "sample data restored" notice and
      never re-runs. HIGH: overlapping runs could show a stale error over a success (fixed
      with a generation guard); `db.query` rejected multi-statement SQL (switched to
      `db.exec`, result shape is now per-statement, last shown); uncapped grid froze on
      huge results (capped at 500 DOM rows, true count still reported). MEDIUM: schema
      refresh now diffs before setState (no per-run editor reconfigure). LOW: bytea renders
      as `\x…` hex. Extracted the run state machine into `useQueryRunner` + added
      `initialSql`/`onRunComplete` props so Phase 3 can reuse the console without forking.
      All verified in-browser. Baseline tag moved to HEAD after these fixes.
- [x] **2.4** Always-visible sample-data panel: show the relevant table's 10 rows beside the
      editor (per [[DATASET.md]] "how the app should render this").
      _Verify:_ in-browser (Playwright) — panel below the console shows the active table's 10
      rows via the same ResultGrid; tabs for all 10 seeded tables; switching users→orders
      updates columns+rows and renders NULL chips (guest order 105, NULL shipped_at);
      refetches after a reset; console clean. Table name is a fixed allowlist (safe identifier).
      _Commit:_ `feat: add always-visible sample data panel`
- [x] **2.5** Render `EXPLAIN` / `EXPLAIN ANALYZE` output readably (plan tree, not raw text).
      _Verify:_ in-browser (Playwright) — `EXPLAIN ANALYZE <join>` renders a nested plan tree
      (Hash Join → Seq Scan on orders + Hash → Seq Scan on users) with node types, relation,
      cost/rows estimates, ANALYZE actuals (rows + ms), and the join condition; estimate-vs-
      actual drift is visible; a plain SELECT still shows the grid (no regression); console
      clean. An EXPLAIN is transparently re-run with FORMAT JSON added (plan is identical, only
      serialization changes). The rewriter was checked against the official PG18 EXPLAIN
      grammar (legacy form is only `[ANALYZE] [VERBOSE]`, in that order) and all 8 EXPLAIN
      forms verified to run in real PGlite.
      _Commit:_ `feat: format explain output as a plan view`

## Phase 3 — Lesson & quiz engine

- [x] **3.1** Define the lesson content schema (TS types): a lesson has teach content, a
      dataset context, questions (typed per the taxonomy in [[CURRICULUM.md]]), and reveals.
      _Verify:_ `npx tsc --noEmit` passes; the sample lesson (`content/lessons/tier1-select.ts`,
      unit 1.1, a write-query + a multiple-choice trap) type-checks; a node:test (transpile-with-
      tsc, zero deps) asserts it validates structurally (35 tests green). Also proved the
      Question union narrows per `kind` and is exhaustively checkable (a missing case is a
      `never` compile error) — the property 3.4's grader relies on.
      _Design:_ spec-first via interview → `SPEC.md`. Questions = closed discriminated union of
      the 11 taxonomy kinds; content authored as typed TS object modules; DB context = optional
      `setupSql` on the reseeded grading instance (per the grading-isolation decision — no
      pristine flag needed); write-query comparison configurable per question (`compare.orderMatters`).
      _Commit:_ `feat: define lesson and question content model`
- [x] **3.2** Lesson view: render teach content (markdown) + worked example + the live editor
      pre-loaded with the example.
      _Verify:_ in-browser (Playwright) — the sample lesson (unit 1.1) renders end to end:
      "Tier 1 · Unit 1.1" badge + title, teach markdown (## heading, paragraphs with inline
      `code` and **bold**, a fenced sql block) all as text nodes, and the QueryConsole preloaded
      with `exampleSql`; running the preloaded example returned "10 rows · 29 ms" with the NULL
      chip on row 4. Typecheck clean, 35 tests green, console clean.
      _Design:_ zero-dep `TeachContent` renderer for the fixed teach markdown subset (headings,
      paragraphs, bold, inline code, ```sql fences) — no react-markdown; content is trusted typed
      TS, rendered as React text nodes (never dangerouslySetInnerHTML). `LessonView` composes
      title + teach + a `QueryConsole` seeded with `exampleSql`.
      _Commit:_ `feat: add lesson view with teach content and live example`
- [x] **3.3** Quiz flow: present a question, accept an answer (multiple-choice AND
      write-the-query typed against PGlite), then reveal answer + reasoning.
      _Verify:_ in-browser (Playwright) — all three wired kinds work: multiple-choice (select →
      Submit → reveal disables options, marks right/wrong, shows why + distractors), predict-output
      (Reveal result shows the authored `(0 rows)` for the `= NULL` trap + why), write-query
      (embedded live console + Show answer reveals the reference). Console clean. Also fixed a
      content bug found by verifying against the seed: q2 claimed 2 NULL full_names / answer 8;
      the seed has exactly 1 (id 4) → answer 9. Typecheck clean, 35 tests green.
      _Design:_ 3.3 = interaction + reveal only; grading verdicts → 3.4.
      `QuizFlow` inside `LessonView`, sequential cards, answer state lifted to QuizFlow
      (`Record<id,{status,selectedIndex?,correct?}>`) for 4.2. Kinds wired: multiple-choice,
      write-query, predict-output + a reveal-only fallback (also correct for explain-mechanism).
      Reveal is terminal (no re-answer). Traps heeded: prompts rendered via TeachContent;
      distractors shown as a list; predict-output uses its own static table (not ResultGrid); no
      `onRunComplete` passed (avoids the memoization/infinite-loop hazard). HIGH-1 deferred to 3.4.
      _Commit:_ `feat: add quiz flow with answer and reasoned reveal`
- [x] **3.4** Write-the-query grading: run the learner's SQL and the reference SQL against
      PGlite, compare result sets, report match/mismatch with the diff.
      _Verify:_ in-browser (Playwright) — the correct answer to q1 (`… WHERE status = 'active'`)
      shows "✓ Correct" and reveals the reference; a wrong answer (omit the WHERE) shows
      "Expected 7 rows, got 10" + a "Shouldn't be in your result (3)" grid listing exactly the 3
      non-active users (anon4/edsger/barbara). Console clean. Comparator has 13 unit tests
      (numeric scale, NaN≠NULL, bigint, money, jsonb key order, multiset, order); 49 tests green.
      _Design (with a live PGlite probe of JS return types):_
      Two commits — (1) `refactor(runner): extract pure executeSql`; (2) this feat. Grading runs on
      a dedicated PGlite created once + reset-reseeded per grade (instance.ts, globalThis-cached,
      prewarmed on card mount, mutex-serialized). Per-grade: DISCARD ALL (temp tables survive
      DROP SCHEMA — verified) → resetDatabase → setupSql (question overrides lesson) → REFERENCE
      first (oracle on pristine state) → learner → compareResults. Comparator (compare.ts, zero
      imports) encodes each cell to an OID-guided type-tagged pair so `avg` scale noise, NaN,
      bigint, and money don't misgrade; unordered multiset by default, order-aware when
      `compare.orderMatters`. Diff = missing/extra sample rows + counts. content.test asserts every
      referenceSql is a non-mutating SELECT (the oracle invariant). HIGH-1 done here as step 1.
      _Known risk (logged):_ no statement timeout — `pg_sleep` in a graded answer wedges the
      grading mutex; exposure-parity with the console, deferred.
      _Commit:_ `feat: grade write-the-query answers by result-set comparison`

## Phase 4 — Navigation, progress, content authoring

- [x] **4.1** Curriculum navigation: tiers → units from [[CURRICULUM.md]] and [[DESIGN.md]]
      (design taught first), with lesson list.
      _Verify:_ in-browser (Playwright) — sidebar shows the full 70-unit tree, Database Design
      first then Tier 0→5; expanding Tier 1 shows 1.1 as a link and the rest as muted "soon";
      clicking 1.1 → `/lesson/1-1` renders the lesson with a working console and highlights the
      active nav item; landing "/" offers "Start learning →" to the first built unit. No-remount
      check passed: DELETE reviews, client-nav lesson→home→lesson via <Link>, reviews still empty
      (single PGlite instance survived route changes). Typecheck clean, 52 tests green, console clean.
      _Design:_ hand-authored `curriculum.ts` outline (ordering
      authority) + `content/index.ts` registry (unit→Lesson, built-state derived, throws on dup).
      Real routes `/lesson/[slug]` (slug = unit with `.`→`-`, since a dot in a path segment breaks
      static-host clean URLs — matters for 5.2 static export). Nav in the root layout OUTSIDE the
      DB provider so it renders during the "Starting Postgres" splash and never remounts. New
      content tests: no dup units, slug round-trips for all 70 units, lesson↔outline tier
      consistency. Deferred: progress ticks → 4.2; real lesson content → 4.3/4.4; responsive → 5.1.
      _Note:_ navigating away discards quiz/editor component state but the shared DB keeps
      mutations — intended; 4.2 persists completion in localStorage, outside component state.
      _Commit:_ `feat: add curriculum navigation with design-first ordering`
- [ ] **4.2** Progress tracking (localStorage): mark lessons/quizzes complete, show progress.
      _Verify:_ completing a lesson persists across reload.
      _Commit:_ `feat: track lesson progress in localstorage`
- [ ] **4.3** Author the first real lesson cluster: DESIGN §1–§3 (design thinking) as full
      lessons + questions + reveals.
      _Commit:_ `feat: author design-thinking lessons (entities and relationships)`
- [ ] **4.4** Author the first query lesson cluster: Tier 0 + Tier 1 SELECT/WHERE/JOIN with
      questions tied to the seeded data.
      _Commit:_ `feat: author beginner query lessons`

## Phase 5 — Polish & ship

- [ ] **5.1** Responsive layout, light/dark theme, keyboard shortcuts.
      _Commit:_ `feat: responsive layout and theming`
- [ ] **5.2** Static export config + deploy setup.
      _Commit:_ `build: configure static export for deployment`
- [ ] **5.3** Milestone: `@deep-reviewer` pass over the whole build; address findings.

---

## Notes / decisions log

- **Engine:** PGlite (WASM, in-browser). No backend. Concurrency/locking lessons that need
  multiple real connections will be *simulated/illustrated* (PGlite is single-connection) —
  flagged when we reach them.
- **Stack:** Next.js (App Router) + TS + Tailwind + CodeMirror 6 + PGlite.
- **PGlite must be client-only** (WASM in browser) — Provider is a `'use client'` component.
- **Content pinned to PostgreSQL 18** throughout.
- **Ralph loop:** eligible from Phase 2 onward, once patterns are established. Not before —
  early steps (stack choices, provider wiring) want a human watching.
- **Persistence: memory-only, by deliberate choice.** `PGlite.create()` runs with no
  `dataDir`, so every reload starts fresh and re-seeds. This keeps the curated state always
  pristine and makes reset trivial. Progress is tracked in localStorage (task 4.2), not in
  the DB. **Do NOT add `idb://` persistence casually:** `seedDatabase`'s atomicity and the
  `isSeeded` schema-presence guard both assume a partially-seeded DB can never survive a
  reload — persisting the DB would make a mid-seed failure permanently brick a learner's
  session. If persistence is ever wanted, revisit `seed.ts` first.
- **Grading isolation — DECIDED (2026-07-12): a dedicated grading PGlite instance,
  created once and reset-reseeded per grade.** The learner mutates the main shared instance
  freely (DELETE/UPDATE/DDL by design); grading a write-the-query answer against that mutated
  world would fail correct answers. Options weighed: (A) reset-before-grade on the main DB —
  rejected: wipes the learner's scratch work and visibly disturbs the UI (console clear, live
  panels rebuild); (B) a second isolated instance — chosen; (C) snapshot/restore — not pursued
  (unverified API, and B is fast enough). **Measured, not assumed** (headless, this PG18 build):
  creating a *fresh* seeded instance per grade costs ~3.0 s (the `PGlite.create()` WASM boot
  dominates) — too slow for interactive grading. Creating the grading instance **once** (~4.4 s,
  lazy/one-time) and then `DROP SCHEMA + reseed` per grade costs **~290 ms median** — 10× faster,
  interactive. So: one long-lived grading instance, `resetDatabase()`-style reseed before each
  grade, learner's main DB never touched.
  **Consequence for 3.1:** the lesson schema needs NO `assumesPristine` flag on the learner DB —
  grading always runs against a freshly-reseeded grading instance, invisibly. Reference results
  are computed there, not against what the learner sees.
  **Consequence for 3.4 / HIGH-1:** extract a pure `executeSql(db, sql)` (discriminated-union
  result) from `useQueryRunner` so the grader can drive runs against the grading `db` without
  touching console state or the generation counter. Do this extraction as part of 3.1/3.4 prep.
- **Deep review (Fable) at Phase 1 milestone:** done at HEAD `97c9815`+fixes. HIGH-1 (atomic
  seed + boot error path), HIGH-2 (`DROP SCHEMA` reset removes learner DDL), HIGH-3 (permanent
  DATASET.md fidelity test, `npm test`) all addressed. Baseline tag `deep-review/last` set.
- **Deep review (Fable) at Phase 2 milestone:** done over the 6-commit delta (tasks 2.4–2.5 +
  fixes). Verdict APPROVE. Acted on: MEDIUM-1 (commented EXPLAIN no longer fabricates a syntax
  error) and MEDIUM-2 (plan tree renders every condition + Rows Removed by Filter). Deferred to
  Phase-3 prep: HIGH-1 (extract `executeSql` + discriminated union — now tied to the grading
  decision above) and MEDIUM-3 (a `useAppLiveQuery` wrapper, once a 2nd live view exists).
  Baseline tag `deep-review/last` moved to `f2ad61d`. Next deep review: end of Phase 3.
