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
- [ ] **1.3** On PGlite init, run schema + seed once (idempotent). Add a "reset database"
      action that re-seeds.
      _Verify:_ fresh load has data; reset restores it after edits.
      _Commit:_ `feat: auto-seed pglite on init with a reset action`

## Phase 2 — The SQL editor & result grid (the core surface)

- [ ] **2.1** Add a CodeMirror SQL editor component (SQL syntax highlighting, run on
      Cmd/Ctrl+Enter).
      _Verify:_ can type SQL and trigger a run handler.
      _Commit:_ `feat: add codemirror sql editor`
- [ ] **2.2** Execute editor SQL against PGlite; render results in a DB-client-style grid
      (monospace, zebra rows, right-aligned numbers, explicit NULL chips per [[DATASET.md]]).
      _Verify:_ `SELECT * FROM users` shows the 10 rows with NULLs rendered as chips.
      _Commit:_ `feat: run queries and render results in a db-style grid`
- [ ] **2.3** Handle errors like real Postgres: show the SQLSTATE + message on a bad query,
      not a crash. Show rows-affected / timing for DML.
      _Verify:_ a syntax error and a constraint violation each render a proper PG error.
      _Commit:_ `feat: surface postgres errors and query timing`
- [ ] **2.4** Always-visible sample-data panel: show the relevant table's 10 rows beside the
      editor (per [[DATASET.md]] "how the app should render this").
      _Verify:_ the panel shows a table's rows and updates when the active table changes.
      _Commit:_ `feat: add always-visible sample data panel`
- [ ] **2.5** Render `EXPLAIN` / `EXPLAIN ANALYZE` output readably (plan tree, not raw text).
      _Verify:_ `EXPLAIN SELECT ...` shows a formatted plan.
      _Commit:_ `feat: format explain output as a plan view`

## Phase 3 — Lesson & quiz engine

- [ ] **3.1** Define the lesson content schema (TS types): a lesson has teach content, a
      dataset context, questions (typed per the taxonomy in [[CURRICULUM.md]]), and reveals.
      _Verify:_ types compile; one sample lesson object validates.
      _Commit:_ `feat: define lesson and question content model`
- [ ] **3.2** Lesson view: render teach content (markdown) + worked example + the live editor
      pre-loaded with the example.
      _Verify:_ a sample lesson renders end to end.
      _Commit:_ `feat: add lesson view with teach content and live example`
- [ ] **3.3** Quiz flow: present a question, accept an answer (multiple-choice AND
      write-the-query typed against PGlite), then reveal answer + reasoning.
      _Verify:_ a predict-output question and a write-the-query question both work.
      _Commit:_ `feat: add quiz flow with answer and reasoned reveal`
- [ ] **3.4** Write-the-query grading: run the learner's SQL and the reference SQL against
      PGlite, compare result sets, report match/mismatch with the diff.
      _Verify:_ a correct answer passes; a wrong one shows how the result differs.
      _Commit:_ `feat: grade write-the-query answers by result-set comparison`

## Phase 4 — Navigation, progress, content authoring

- [ ] **4.1** Curriculum navigation: tiers → units from [[CURRICULUM.md]] and [[DESIGN.md]]
      (design taught first), with lesson list.
      _Verify:_ can navigate the tier/unit tree to a lesson.
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
