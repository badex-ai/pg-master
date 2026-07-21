/**
 * Tier 0 · Unit 0.4 — NULL and three-valued logic.
 *
 * The mental model underneath the 1.2 WHERE trap: NULL is "unknown", not a value, so every
 * comparison against it yields UNKNOWN and WHERE keeps only TRUE. Built on the seed's real
 * NULL-bearing columns — users.full_name (one NULL, id 4), orders.shipped_at (four NULLs) —
 * so the counts a learner sees are the counts the harness pins. Runs against the base seed
 * (no setupSql).
 */

import type { Lesson } from '@/lib/content/types';

export const tier0Null: Lesson = {
  id: 'tier0.null',
  unit: '0.4',
  tier: 0,
  title: 'NULL and three-valued logic',
  teach: `## NULL is not a value — it is the absence of one

Most languages have one notion of "nothing" and it compares equal to itself: in Python
\`None == None\` is \`True\`. SQL does not work that way, and assuming it does is the single most
reliable source of wrong answers in this whole track.

\`NULL\` means **unknown**. Two unknowns are not known to be equal — they are not known to be
*anything*. So:

\`\`\`sql
SELECT NULL = NULL;    -- NULL, not true
SELECT NULL <> NULL;   -- NULL, not false
SELECT 5 > NULL;       -- NULL
\`\`\`

**Three-valued logic.** Because comparisons can come back unknown, SQL's booleans have three
values, not two: **TRUE**, **FALSE**, and **UNKNOWN**. \`WHERE\` keeps a row only when the
condition is TRUE. A row whose condition is UNKNOWN is dropped exactly like a FALSE one — but
it is *not* the same thing, and the difference shows the moment you negate.

\`NOT TRUE\` is FALSE. \`NOT FALSE\` is TRUE. But \`NOT UNKNOWN\` is still **UNKNOWN**. That
breaks a law you have relied on since school: \`x = 'a' OR x <> 'a'\` is not a tautology in SQL.
When \`x\` is NULL, both sides are UNKNOWN, the OR is UNKNOWN, and the row vanishes.

**Testing for NULL.** Since \`= NULL\` is never TRUE, it never matches anything — it is not an
error, just silently empty. Use the dedicated predicates:

\`\`\`sql
SELECT * FROM users WHERE full_name IS NULL;      -- correct
SELECT * FROM users WHERE full_name = NULL;       -- always zero rows
\`\`\`

There is also \`IS DISTINCT FROM\`, the NULL-safe \`<>\`: it treats two NULLs as equal-to-each-other
and a NULL versus a value as different, giving you a plain TRUE/FALSE with no UNKNOWN in sight.

**Aggregates skip NULLs.** Every aggregate except \`count(*)\` ignores NULL inputs. So
\`count(*)\` counts rows while \`count(col)\` counts *non-NULL values of col* — and \`avg\`
divides by the number of non-NULL values, not by the number of rows. That is usually what you
want, but it means \`avg(x)\` and \`sum(x) / count(*)\` are different queries.

**Why the design allows it.** NULL is not a flaw to be avoided everywhere — \`orders.shipped_at\`
is NULL precisely because an unshipped order *has* no ship date, and inventing a sentinel like
\`1970-01-01\` would be worse. The skill is knowing the logic changes once a column is nullable.`,
  exampleSql: `SELECT id, full_name, city
FROM users
WHERE full_name IS NULL;`,
  questions: [
    {
      id: 'q1',
      kind: 'predict-output',
      prompt:
        'Every user either is named Ada Lovelace or is not — so this looks like it must return ' +
        'all 10 users. There are 10 rows in `users`. Predict what it actually returns:\n\n' +
        '```sql\nSELECT count(*) AS n FROM users\nWHERE full_name = \'Ada Lovelace\' OR full_name <> \'Ada Lovelace\';\n```',
      sql: `SELECT count(*) AS n FROM users WHERE full_name = 'Ada Lovelace' OR full_name <> 'Ada Lovelace'`,
      expected: { columns: ['n'], rows: [[9]] },
      themes: ['null-correctness'],
      // The whole lesson is 9-not-10. Pin: the tautology yields 9, the table really has 10 rows,
      // and exactly one user (id 4) has a NULL full_name — the row the "tautology" drops.
      verify: [
        {
          sql: `SELECT count(*)::text FROM users WHERE full_name = 'Ada Lovelace' OR full_name <> 'Ada Lovelace'`,
          equals: '9',
        },
        { sql: `SELECT count(*)::text FROM users`, equals: '10' },
        { sql: `SELECT id::text FROM users WHERE full_name IS NULL`, equals: '4' },
      ],
      reveal: {
        correct: '9 — one row short of the table, even though the condition looks like a tautology.',
        why:
          'User 4 has a NULL `full_name`. For that row `full_name = \'Ada Lovelace\'` is UNKNOWN ' +
          'and `full_name <> \'Ada Lovelace\'` is *also* UNKNOWN — a NULL is not known to be equal ' +
          'to the string, nor known to differ from it. `UNKNOWN OR UNKNOWN` is UNKNOWN, and WHERE ' +
          'keeps a row only when the condition is TRUE, so row 4 is dropped. The law of the ' +
          'excluded middle does not hold in three-valued logic: over a nullable column, ' +
          '`x = v OR x <> v` is not a tautology.',
        reproduceSql:
          `SELECT id, full_name,\n` +
          `       (full_name = 'Ada Lovelace') AS eq,\n` +
          `       (full_name <> 'Ada Lovelace') AS ne\n` +
          `FROM users ORDER BY id;   -- row 4 is NULL in both columns`,
      },
    },
    {
      id: 'q2',
      kind: 'multiple-choice',
      prompt:
        'You want the users whose `full_name` is missing. How many rows does ' +
        '`SELECT * FROM users WHERE full_name = NULL;` return?',
      choices: ['0', '1', '10', 'An error — you must use IS NULL'],
      answerIndex: 0,
      themes: ['null-correctness'],
      // The reveal contrasts `= NULL` (0 rows, no error) against `IS NULL` (1 row, id 4).
      verify: [
        { sql: `SELECT count(*)::text FROM users WHERE full_name = NULL`, equals: '0' },
        { sql: `SELECT count(*)::text FROM users WHERE full_name IS NULL`, equals: '1' },
      ],
      reveal: {
        correct: '0 rows — it runs perfectly happily and silently matches nothing.',
        why:
          '`full_name = NULL` is a comparison against an unknown, so it evaluates to UNKNOWN for ' +
          'every row — including the row that IS NULL, because "unknown equals unknown" is itself ' +
          'unknown. WHERE keeps only TRUE, so nothing survives. The danger is that this is not an ' +
          'error: the query succeeds and returns an empty set, which reads like "no such users" ' +
          'rather than "you wrote the wrong predicate". `IS NULL` is a distinct predicate that ' +
          'tests nullness directly and returns TRUE/FALSE, never UNKNOWN — it finds the one row.',
        distractors: [
          '1 is what `WHERE full_name IS NULL` returns — the correct way to ask this question.',
          '10 would require the predicate to be TRUE for every row; it is TRUE for none of them.',
          'It is not an error: `=` is perfectly valid against NULL, which is exactly why the bug is easy to miss.',
        ],
        reproduceSql:
          `SELECT count(*) AS via_equals FROM users WHERE full_name = NULL;\n` +
          `SELECT count(*) AS via_is_null FROM users WHERE full_name IS NULL;`,
      },
    },
    {
      id: 'q3',
      kind: 'predict-output',
      prompt:
        'The `orders` table has 10 rows. `shipped_at` is NULL for orders that have not shipped. ' +
        'Predict both counts:\n\n' +
        '```sql\nSELECT count(*) AS all_rows, count(shipped_at) AS shipped\nFROM orders;\n```',
      sql: `SELECT count(*) AS all_rows, count(shipped_at) AS shipped FROM orders`,
      expected: { columns: ['all_rows', 'shipped'], rows: [[10, 6]] },
      themes: ['null-correctness', 'set-based-thinking'],
      // Pin both counts and the identity of the four unshipped orders the reveal names.
      verify: [
        { sql: `SELECT count(*)::text FROM orders`, equals: '10' },
        { sql: `SELECT count(shipped_at)::text FROM orders`, equals: '6' },
        {
          sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM orders WHERE shipped_at IS NULL`,
          equals: '104,105,106,108',
        },
      ],
      reveal: {
        correct: 'all_rows = 10, shipped = 6.',
        why:
          '`count(*)` counts rows and never looks at a value, so it reports the full 10. ' +
          '`count(shipped_at)` counts *non-NULL values in that column* — aggregates discard NULL ' +
          'inputs before they aggregate — so the four unshipped orders (104, 105, 106 and 108) ' +
          'contribute nothing and it reports 6. The same skipping rule drives `avg`, `sum`, `min` ' +
          'and `max`, which is why `avg(x)` divides by the non-NULL count and therefore differs ' +
          'from `sum(x) / count(*)` on any nullable column.',
        reproduceSql:
          `SELECT count(*) AS all_rows, count(shipped_at) AS shipped FROM orders;\n` +
          `-- the rows count(shipped_at) ignores:\n` +
          `SELECT id, status, shipped_at FROM orders WHERE shipped_at IS NULL ORDER BY id;`,
      },
    },
    {
      id: 'q4',
      kind: 'write-query',
      prompt:
        'Return `id` and `full_name` for every user whose `full_name` is *not* `Ada Lovelace`, ' +
        'counting a missing name as "not Ada" — so the user with a NULL name must appear. ' +
        'Return their real `full_name` value (NULL is fine). Row order does not matter.',
      // IS DISTINCT FROM is the NULL-safe <>: TRUE for the NULL row instead of UNKNOWN.
      referenceSql: `SELECT id, full_name FROM users WHERE full_name IS DISTINCT FROM 'Ada Lovelace'`,
      themes: ['null-correctness'],
      // The reveal claims plain <> returns 8 while IS DISTINCT FROM returns 9 (the extra row
      // being id 4), and that Ada herself is excluded by both. Pin all three.
      verify: [
        {
          sql: `SELECT count(*)::text FROM users WHERE full_name IS DISTINCT FROM 'Ada Lovelace'`,
          equals: '9',
        },
        { sql: `SELECT count(*)::text FROM users WHERE full_name <> 'Ada Lovelace'`, equals: '8' },
        // The exact kept set: Ada (id 1) excluded by both forms, id 4 kept only by the NULL-safe one.
        {
          sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM users WHERE full_name IS DISTINCT FROM 'Ada Lovelace'`,
          equals: '2,3,4,5,6,7,8,9,10',
        },
        { sql: `SELECT id::text FROM users WHERE full_name = 'Ada Lovelace'`, equals: '1' },
      ],
      reveal: {
        correct: `SELECT id, full_name FROM users WHERE full_name IS DISTINCT FROM 'Ada Lovelace';`,
        why:
          'The obvious `full_name <> \'Ada Lovelace\'` returns only 8 rows: it excludes Ada (id 1) ' +
          'as intended, but it also silently drops user 4, whose NULL name makes the comparison ' +
          'UNKNOWN rather than TRUE. `IS DISTINCT FROM` is the NULL-safe form of `<>` — it treats ' +
          'NULL as a comparable state, so "NULL is distinct from \'Ada Lovelace\'" is plainly TRUE ' +
          'and row 4 is kept, giving 9. `COALESCE(full_name, \'\') <> \'Ada Lovelace\'` would also ' +
          'work but invents a fake value to compare; `IS DISTINCT FROM` says what you actually mean.',
        reproduceSql:
          `SELECT id, full_name FROM users WHERE full_name IS DISTINCT FROM 'Ada Lovelace' ORDER BY id;\n` +
          `-- contrast: plain <> loses the NULL-named user\n` +
          `SELECT id, full_name FROM users WHERE full_name <> 'Ada Lovelace' ORDER BY id;`,
      },
    },
  ],
};
