/**
 * Tier 1 · Unit 1.3 — Sorting and limiting.
 *
 * ORDER BY (multiple keys, ASC/DESC, NULLS FIRST/LAST), LIMIT/OFFSET and why OFFSET is a scaling
 * hazard, and the SQL-standard FETCH FIRST form. The headline traps are (1) the default NULL
 * ordering flips with ASC vs DESC, exploited by the one NULL full_name (user id 4), and (2) a
 * LIMIT without a total ORDER BY is non-deterministic. Runs against the base seed.
 */

import type { Lesson } from '@/lib/content/types';

export const tier1OrderLimit: Lesson = {
  id: 'tier1.order-limit',
  unit: '1.3',
  tier: 1,
  title: 'Sorting and limiting',
  teach: `## Ordering the result

A relational result is an *unordered* set until you impose an order with \`ORDER BY\`. It runs
after SELECT (logical order: … → SELECT → ORDER BY → LIMIT), so it can sort by output columns
and aliases.

\`\`\`sql
SELECT full_name, city FROM users ORDER BY city ASC, full_name DESC;
\`\`\`

Sort keys apply left to right: ties on the first key break on the second, and so on.

**Where NULLs sort.** By default \`ASC\` puts NULLs **last** and \`DESC\` puts them **first** —
the default flips with the direction. Say what you mean with \`NULLS FIRST\` / \`NULLS LAST\`,
which override the default independently of ASC/DESC.

**Limiting.** \`LIMIT n\` caps the row count; \`OFFSET m\` skips the first \`m\`. The SQL-standard
spelling is \`FETCH FIRST n ROWS ONLY\`. Two things bite:

- \`LIMIT\` without a **total** \`ORDER BY\` returns an arbitrary subset — "top 3" is meaningless
  if the sort has ties or no order at all; the engine may return any matching rows.
- \`OFFSET\` still reads and discards the skipped rows, so deep pagination (\`OFFSET 100000\`)
  gets linearly slower. At scale you switch to *keyset* pagination (a later unit) — for now,
  just know \`OFFSET\` is not free.`,
  exampleSql: `SELECT id, full_name, created_at
FROM users
ORDER BY created_at DESC
LIMIT 3;`,
  questions: [
    {
      id: 'q1',
      kind: 'write-query',
      prompt:
        'Return the `id` and `total` of the 3 most expensive orders, highest total first. ' +
        'Return exactly those two columns, and the rows must be in that order.',
      referenceSql: `SELECT id, total FROM orders ORDER BY total DESC LIMIT 3`,
      compare: { orderMatters: true },
      themes: ['set-based-thinking'],
      // orderMatters oracle — the top 3 totals are 1858.00, 1418.99, 999.00 with no ties at the
      // boundary, so the ordering is unambiguous. Pin the ordered id sequence and that the 3rd/4th
      // totals differ (no tie that would make LIMIT 3 non-deterministic).
      verify: [
        {
          sql: `SELECT string_agg(id::text, ',') FROM (SELECT id FROM orders ORDER BY total DESC LIMIT 3) t`,
          equals: '103,101,104',
        },
        {
          sql: `SELECT (min(total) > (SELECT max(total) FROM orders WHERE total NOT IN (SELECT total FROM orders ORDER BY total DESC LIMIT 3)))::text
                 FROM (SELECT total FROM orders ORDER BY total DESC LIMIT 3) t`,
          equals: 'true',
        },
      ],
      reveal: {
        correct: `SELECT id, total FROM orders ORDER BY total DESC LIMIT 3;`,
        why:
          'ORDER BY total DESC sorts highest first; LIMIT 3 then keeps the leading three: order ' +
          '103 (1858.00), 101 (1418.99), and 104 (999.00). Because the third and fourth totals ' +
          'differ, the boundary is unambiguous — no tie makes the third slot arbitrary. LIMIT ' +
          'without the ORDER BY would return any three orders.',
        reproduceSql: `SELECT id, total FROM orders ORDER BY total DESC LIMIT 3;`,
      },
    },
    {
      id: 'q2',
      kind: 'predict-output',
      prompt:
        'User id 4 has a NULL `full_name`; every other user has one. Predict the FIRST id ' +
        'returned (note the DESC and the default NULL placement):\n\n' +
        '```sql\nSELECT id FROM users ORDER BY full_name DESC LIMIT 1;\n```',
      sql: `SELECT id FROM users ORDER BY full_name DESC LIMIT 1`,
      // DESC default is NULLS FIRST, so the NULL full_name (id 4) sorts first and is the single row.
      expected: { columns: ['id'], rows: [[4]] },
      themes: ['null-correctness', 'logical-eval-order'],
      verify: [
        { sql: `SELECT id::text FROM users ORDER BY full_name DESC LIMIT 1`, equals: '4' },
        { sql: `SELECT id::text FROM users WHERE full_name IS NULL`, equals: '4' },
        // Contrast the reveal cites: ASC default is NULLS LAST, so ASC LIMIT 1 is NOT id 4.
        { sql: `SELECT (id <> 4)::text FROM users ORDER BY full_name ASC LIMIT 1`, equals: 'true' },
      ],
      reveal: {
        correct: 'id 4 — the row whose full_name is NULL.',
        why:
          'For `ORDER BY … DESC` the default NULL placement is NULLS FIRST, so the NULL full_name ' +
          '(user 4) sorts ahead of every real name and LIMIT 1 returns it. The default flips with ' +
          'direction: `ORDER BY full_name ASC` defaults to NULLS LAST, and its LIMIT 1 would return ' +
          'a real name instead. Write `NULLS LAST` explicitly if you want the NULL out of the way ' +
          'regardless of direction.',
        reproduceSql:
          `SELECT id, full_name FROM users ORDER BY full_name DESC LIMIT 1;\n` +
          `-- vs the ASC default (NULLS LAST):\n` +
          `SELECT id, full_name FROM users ORDER BY full_name ASC LIMIT 1;`,
      },
    },
    {
      id: 'q3',
      kind: 'multiple-choice',
      prompt:
        'You want a stable "page 2" of users, 3 per page, ordered by `city`. ' +
        'Several users share a city (two are in London, two in New York). ' +
        'Which query paginates *deterministically*?',
      choices: [
        `SELECT * FROM users ORDER BY city LIMIT 3 OFFSET 3`,
        `SELECT * FROM users ORDER BY city, id LIMIT 3 OFFSET 3`,
        `SELECT * FROM users LIMIT 3 OFFSET 3`,
        `SELECT * FROM users ORDER BY city OFFSET 3`,
      ],
      answerIndex: 1,
      themes: ['set-based-thinking'],
      // The prompt claims duplicate cities exist (London ×2, New York ×2) — that's what makes a
      // city-only sort non-deterministic. Pin those duplicates.
      verify: [
        { sql: `SELECT count(*)::text FROM users WHERE city = 'London'`, equals: '2' },
        { sql: `SELECT count(*)::text FROM users WHERE city = 'New York'`, equals: '2' },
      ],
      reveal: {
        correct: `SELECT * FROM users ORDER BY city, id LIMIT 3 OFFSET 3;`,
        why:
          'OFFSET/LIMIT only slice a *defined* order. `ORDER BY city` alone leaves ties (two ' +
          'Londons, two New Yorks) in an engine-chosen order, so which rows land on page 2 can ' +
          'shift between runs — rows get skipped or repeated across pages. Adding a unique ' +
          'tiebreaker (`, id`) makes the total order deterministic, so pagination is stable.',
        distractors: [
          'ORDER BY city alone: the tied cities have no defined order, so page boundaries are unstable.',
          'No ORDER BY at all: the row order is arbitrary, so OFFSET slices an undefined sequence.',
          'OFFSET with no LIMIT returns everything after row 3 — not a fixed-size page.',
        ],
        reproduceSql:
          `SELECT id, city FROM users ORDER BY city, id LIMIT 3 OFFSET 3;`,
      },
    },
    {
      id: 'q4',
      kind: 'write-query',
      prompt:
        'List all users ordered by `country` A→Z, and within each country by newest signup ' +
        '(`created_at`) first. Return `id`, `country`, `created_at`. Order matters.',
      referenceSql: `SELECT id, country, created_at FROM users ORDER BY country ASC, created_at DESC`,
      compare: { orderMatters: true },
      themes: ['set-based-thinking'],
      // Multi-key ordering. country has no NULLs; created_at has no NULLs — so a full deterministic
      // order except any (country, created_at) exact tie. Pin that there is no such duplicate pair,
      // so the reference order is total and the oracle is deterministic.
      verify: [
        {
          sql: `SELECT (count(*) = count(DISTINCT (country, created_at)))::text FROM users`,
          equals: 'true',
        },
        { sql: `SELECT string_agg(DISTINCT country, ',' ORDER BY country) FROM users WHERE country IN ('Finland','UK')`, equals: 'Finland,UK' },
      ],
      reveal: {
        correct: `SELECT id, country, created_at FROM users ORDER BY country ASC, created_at DESC;`,
        why:
          'Two sort keys, applied left to right: rows are grouped by country ascending, and ties ' +
          'within a country break on created_at *descending* (newest first). The two keys can carry ' +
          'different directions — ASC on one, DESC on the other — independently. No two users share ' +
          'the same (country, created_at), so the order is fully determined.',
        reproduceSql: `SELECT id, country, created_at FROM users ORDER BY country ASC, created_at DESC;`,
      },
    },
  ],
};
