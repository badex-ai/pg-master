/**
 * The curriculum outline — the ordered tier/unit tree the navigation renders, mirroring
 * CURRICULUM.md and DESIGN.md. Design is taught first, so its track leads.
 *
 * This is the ordering authority and the full path the learner sees. Whether a unit is *built*
 * (has an authored Lesson) is derived from the lesson registry (content/index.ts), never tracked
 * here — one source of truth for "does content exist", so the two can't drift.
 */

import type { Tier } from './types';

export type UnitOutline = { unit: string; title: string };
export type TierOutline = { tier: Tier; label: string; units: UnitOutline[] };

/** The whole curriculum, in teaching order. Design track first, then Tier 0 → 5. */
export const CURRICULUM: readonly TierOutline[] = [
  {
    tier: 'design',
    label: 'Database Design',
    units: [
      { unit: 'design.1', title: 'Start with the questions, not the tables' },
      { unit: 'design.2', title: 'Find the entities and their relationships' },
      { unit: 'design.3', title: 'Model the relationships (1:1, 1:N, M:N)' },
      { unit: 'design.4', title: 'Normalize — then know when to stop' },
      { unit: 'design.5', title: 'Choose the columns — and defend every one' },
      { unit: 'design.6', title: 'Choose the type for each column' },
      { unit: 'design.7', title: 'Choose keys — primary and foreign' },
      { unit: 'design.8', title: 'Add constraints — push correctness into the schema' },
      { unit: 'design.9', title: 'Design the indexes — from the queries' },
      { unit: 'design.10', title: 'Full teardown: Instagram' },
      { unit: 'design.11', title: 'The design review checklist' },
      { unit: 'design.12', title: 'The same method on other domains' },
    ],
  },
  {
    tier: 0,
    label: 'Tier 0 — Foundations & Mental Model',
    units: [
      { unit: '0.1', title: 'What a relational database is' },
      { unit: '0.2', title: 'The logical order of query evaluation' },
      { unit: '0.3', title: 'SQL is declarative, not imperative' },
      { unit: '0.4', title: 'NULL and three-valued logic' },
      { unit: '0.5', title: 'Data types overview' },
    ],
  },
  {
    tier: 1,
    label: 'Tier 1 — Beginner: Reading & Writing Queries',
    units: [
      { unit: '1.1', title: 'SELECT fundamentals' },
      { unit: '1.2', title: 'Filtering with WHERE' },
      { unit: '1.3', title: 'Sorting and limiting' },
      { unit: '1.4', title: 'Aggregation' },
      { unit: '1.5', title: 'Joins' },
      { unit: '1.6', title: 'Set operations' },
      { unit: '1.7', title: 'Basic data modification (DML)' },
      { unit: '1.8', title: 'Creating and altering tables' },
      { unit: '1.8b', title: 'Auto-generated keys: sequences vs identity' },
      { unit: '1.9', title: 'Handling NULLs in practice' },
    ],
  },
  {
    tier: 2,
    label: 'Tier 2 — Intermediate: Real-World Query Craft',
    units: [
      { unit: '2.1', title: 'Subqueries' },
      { unit: '2.2', title: 'Common Table Expressions (CTEs)' },
      { unit: '2.3', title: 'Window functions' },
      { unit: '2.4', title: 'Advanced grouping and aggregates' },
      { unit: '2.5', title: 'Conditional and pivot logic' },
      { unit: '2.6', title: 'Dates, times, and intervals' },
      { unit: '2.7', title: 'String processing' },
      { unit: '2.8', title: 'Arrays' },
      { unit: '2.9', title: 'JSON and JSONB' },
      { unit: '2.10', title: 'Upserts and conflict handling' },
      { unit: '2.11', title: 'Transactions' },
      { unit: '2.12', title: 'Views' },
      { unit: '2.13', title: 'LATERAL joins' },
    ],
  },
  {
    tier: 3,
    label: 'Tier 3 — Advanced / Mastery',
    units: [
      { unit: '3.1', title: 'Concurrency control and isolation' },
      { unit: '3.2', title: 'Explicit locking' },
      { unit: '3.3', title: 'Constraints, deeply' },
      { unit: '3.4', title: 'Advanced data types & domain modeling' },
      { unit: '3.5', title: 'Full-text search' },
      { unit: '3.6', title: 'Programmability (server-side logic)' },
      { unit: '3.7', title: 'Partitioning' },
      { unit: '3.8', title: 'Inheritance and advanced schema patterns' },
      { unit: '3.9', title: 'Roles, privileges, and access control' },
      { unit: '3.10', title: 'Row-Level Security (RLS)' },
      { unit: '3.11', title: 'XML data and functions' },
      { unit: '3.12', title: 'The rule system and query rewriting' },
    ],
  },
  {
    tier: 4,
    label: 'Tier 4 — Performance, Internals & Operations',
    units: [
      { unit: '4.1', title: 'Reading query plans' },
      { unit: '4.2', title: 'Scan and join node types' },
      { unit: '4.3', title: 'Indexing' },
      { unit: '4.4', title: 'Statistics and the planner' },
      { unit: '4.5', title: 'The physical layer' },
      { unit: '4.6', title: 'Query optimization techniques' },
      { unit: '4.7', title: 'Configuration that affects query behavior' },
      { unit: '4.8', title: 'Observability' },
      { unit: '4.9', title: 'Extensions ecosystem' },
      { unit: '4.10', title: 'Foreign data and cross-database queries' },
    ],
  },
  {
    tier: 5,
    label: 'Tier 5 — Backend Integration',
    units: [
      { unit: '5.1', title: 'The connection model' },
      { unit: '5.2', title: 'Parameterized queries and SQL injection' },
      { unit: '5.3', title: 'Mapping types across the wire' },
      { unit: '5.4', title: 'Transactions from application code' },
      { unit: '5.5', title: 'Error handling' },
      { unit: '5.6', title: 'Migrations & schema evolution' },
      { unit: '5.7', title: 'Query construction in application code' },
      { unit: '5.8', title: 'Bulk and streaming operations' },
    ],
  },
];

/** Every unit id in curriculum order — for "first built lesson" and consistency checks. */
export const ALL_UNITS: readonly string[] = CURRICULUM.flatMap((t) => t.units.map((u) => u.unit));

/**
 * URL slug for a unit id. Dots are replaced with dashes because a dot in a path segment
 * (`/lesson/1.1`) is treated as a file extension by many static hosts' clean-URL rewrites, and
 * a static export is a shipping goal — `/lesson/1-1` stays a real route.
 */
export function unitToSlug(unit: string): string {
  return unit.replace(/\./g, '-');
}

/** Inverse of unitToSlug. `1-8b` → `1.8b`, `design-2` → `design.2`. */
export function slugToUnit(slug: string): string {
  return slug.replace(/-/g, '.');
}
