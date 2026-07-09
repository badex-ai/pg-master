# PG Master — Learn PostgreSQL to Mastery

An interactive web app that teaches PostgreSQL — from **designing** a database from
scratch to **querying** it at an expert level — by teaching each concept, drilling it with
deep questions, revealing the answer *and the reasoning*, and letting you run real SQL
against a **real Postgres** running in your browser.

## The idea

1. **Teach** a concept (with a worked example and visible sample data).
2. **Quiz** with deep, thorough questions (predict-output, spot-the-bug, read-the-plan…).
3. **Reveal** the answer *and why* — the mechanism, why the distractors are wrong.
4. **Practice** in a live SQL editor backed by real Postgres, with the result grid styled
   like a production DB client.

## Architecture

- **Real Postgres in the browser** via [PGlite](https://pglite.dev) (Postgres compiled to
  WASM) — each learner gets their own isolated real Postgres. No backend, no per-user DB
  provisioning, deploys as a static site.
- **Next.js + React + TypeScript**, Tailwind for styling, CodeMirror for the SQL editor.

## The content (source of truth)

The curriculum is authored as four cross-linked spec files that drive every lesson:

| File | What it is |
|------|------------|
| [`DESIGN.md`](./DESIGN.md) | How to **plan** a database from scratch — the method + a full Instagram teardown. Taught first. |
| [`CURRICULUM.md`](./CURRICULUM.md) | How to **query** — the complete skills roadmap, beginner → mastery. |
| [`MASTERY-INSIGHTS.md`](./MASTERY-INSIGHTS.md) | The master-vs-pro judgment layer — the traps only experience teaches. |
| [`DATASET.md`](./DATASET.md) | The visual practice dataset (e-commerce), 10 curated rows per table. |

## Status

Early build. See [`TASKS.md`](./TASKS.md) for the backlog and progress.

## Development

```bash
npm install
npm run dev
```

Pinned to **PostgreSQL 18** semantics throughout the content.
