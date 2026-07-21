/**
 * Tier 0 · Unit 0.2 — The logical order of query evaluation.
 *
 * The clause you write first is not the clause that runs first. Teaches
 * FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT through the two errors the
 * order actually causes: a SELECT alias is invisible to WHERE (42703) but visible to ORDER BY,
 * and an aggregate is illegal in WHERE (42803) but legal in HAVING. Both error questions are
 * `predict-error` — the one kind allowed to reproduce a failure. Runs against the base seed
 * (no setupSql).
 */

import type { Lesson } from '@/lib/content/types';

export const tier0EvalOrder: Lesson = {
  id: 'tier0.eval-order',
  unit: '0.2',
  tier: 0,
  title: 'The logical order of query evaluation',
  teach: `## You write SELECT first. The database runs it almost last.

A SELECT statement is written in one order and evaluated in another. That mismatch is not
trivia — it is the direct cause of two errors every beginner hits, and once you know the order
both stop being mysterious.

**Written order:** \`SELECT … FROM … WHERE … GROUP BY … HAVING … ORDER BY … LIMIT\`

**Logical order:**

\`\`\`
FROM      →  which tables, and how they join
WHERE     →  throw away rows (one row at a time)
GROUP BY  →  collapse the survivors into groups
HAVING    →  throw away whole groups
SELECT    →  compute the output columns, assign aliases
ORDER BY  →  sort what SELECT produced
LIMIT     →  take the first N
\`\`\`

Read that list once more with the aliases in mind. \`SELECT\` is sixth. Everything above it runs
**before any alias exists**.

**Consequence 1 — an alias is invisible to WHERE.** \`SELECT price * 2 AS double_price … WHERE
double_price > 100\` fails with *column "double_price" does not exist*, because WHERE ran before
SELECT invented that name. Repeat the expression (\`WHERE price * 2 > 100\`) or wrap the query in
a subquery. But \`ORDER BY double_price\` works fine — ORDER BY runs *after* SELECT, so by then
the alias is real. The same identifier is invalid in one clause and valid in another, purely
because of when each clause runs.

**Consequence 2 — WHERE cannot see aggregates.** \`WHERE count(*) > 1\` fails with *aggregate
functions are not allowed in WHERE*. WHERE runs before GROUP BY, so at that moment no groups
exist and there is nothing to count. Filtering on an aggregate is HAVING's entire job:

\`\`\`sql
SELECT status, count(*) AS n FROM orders
WHERE  status <> 'cancelled'   -- filters ROWS, before grouping
GROUP BY status
HAVING count(*) > 1;           -- filters GROUPS, after grouping
\`\`\`

The rule of thumb: **WHERE filters rows, HAVING filters groups.** Prefer WHERE when you can —
it discards rows before the grouping work happens, so it is the cheaper of the two.

**"Logical" is not "physical".** This order defines what the query *means*, not the steps the
engine literally performs. The planner reorders joins, pushes filters down, and stops early on
LIMIT, and it is free to do any of that as long as the result matches what this order specifies.
That gap between meaning and execution is unit 0.3's subject.`,
  exampleSql: `SELECT status, count(*) AS n
FROM orders
GROUP BY status
HAVING count(*) > 1
ORDER BY n DESC, status;`,
  questions: [
    {
      id: 'q1',
      kind: 'predict-error',
      prompt:
        'The alias `double_price` is defined right there in the SELECT list. ' +
        'Does this run, or does it fail?\n\n' +
        '```sql\nSELECT id, price * 2 AS double_price\nFROM products\nWHERE double_price > 100;\n```',
      sql: `SELECT id, price * 2 AS double_price FROM products WHERE double_price > 100`,
      runs: false,
      sqlState: '42703',
      themes: ['logical-eval-order'],
      // The reveal claims the same alias succeeds in ORDER BY, and names the top-3 by price.
      // Pin the working contrast and the row identities it cites.
      verify: [
        {
          sql: `SELECT count(*)::text FROM (SELECT id, price * 2 AS double_price FROM products ORDER BY double_price DESC LIMIT 3) t`,
          equals: '3',
        },
        { sql: `SELECT count(*)::text FROM products WHERE price * 2 > 100`, equals: '8' },
        {
          sql: `SELECT string_agg(id::text, ',' ORDER BY price DESC) FROM (SELECT id, price FROM products ORDER BY price DESC LIMIT 3) t`,
          equals: '2,1,3',
        },
      ],
      reveal: {
        correct: 'It fails: ERROR 42703 — column "double_price" does not exist.',
        why:
          'WHERE is evaluated before SELECT. At the moment WHERE runs, the SELECT list has not ' +
          'been computed and the alias `double_price` does not yet exist as a name — hence the ' +
          '"undefined column" error rather than a type or syntax complaint. Postgres is not ' +
          'refusing to look the alias up; there is genuinely nothing there yet. Repeat the ' +
          'expression instead (`WHERE price * 2 > 100`), which matches 8 of the 10 products — '
          + 'the C book at 45.00 and the Mystery Gadget at 19.99 both fall under the threshold. The ' +
          'revealing part: `ORDER BY double_price` on the very same query succeeds, because ' +
          'ORDER BY runs *after* SELECT and the alias exists by then.',
        reproduceSql:
          `-- Repeat the expression in WHERE:\n` +
          `SELECT id, price * 2 AS double_price FROM products WHERE price * 2 > 100 ORDER BY id;\n` +
          `-- And note the same alias is legal in ORDER BY, which runs after SELECT:\n` +
          `SELECT id, price * 2 AS double_price FROM products ORDER BY double_price DESC LIMIT 3;`,
      },
    },
    {
      id: 'q2',
      kind: 'predict-error',
      prompt:
        'This tries to keep only the statuses that appear more than once. ' +
        'Does it run, or does it fail?\n\n' +
        '```sql\nSELECT status, count(*) AS n\nFROM orders\nWHERE count(*) > 1\nGROUP BY status;\n```',
      sql: `SELECT status, count(*) AS n FROM orders WHERE count(*) > 1 GROUP BY status`,
      runs: false,
      sqlState: '42803',
      themes: ['logical-eval-order'],
      // The reveal gives the HAVING fix and names its three surviving groups with counts.
      verify: [
        {
          sql: `SELECT string_agg(status || ':' || n::text, ',' ORDER BY status) FROM (SELECT status, count(*) AS n FROM orders GROUP BY status HAVING count(*) > 1) t`,
          equals: 'delivered:4,paid:2,shipped:2',
        },
        { sql: `SELECT count(*)::text FROM orders`, equals: '10' },
      ],
      reveal: {
        correct: 'It fails: ERROR 42803 — aggregate functions are not allowed in WHERE.',
        why:
          'WHERE runs before GROUP BY, so when WHERE is evaluated the rows have not been collapsed ' +
          'into groups yet and there is nothing for `count(*)` to count. An aggregate is only ' +
          'meaningful once groups exist, which is why the clause that filters on aggregates — ' +
          'HAVING — sits after GROUP BY in the evaluation order. Swapping WHERE for HAVING gives ' +
          'the three statuses that occur more than once: delivered (4), paid (2) and shipped (2). ' +
          'WHERE filters rows; HAVING filters groups.',
        reproduceSql:
          `SELECT status, count(*) AS n\nFROM orders\nGROUP BY status\nHAVING count(*) > 1\nORDER BY n DESC, status;`,
      },
    },
    {
      id: 'q3',
      kind: 'multiple-choice',
      prompt:
        'In which of these clauses is a column alias defined in the SELECT list ' +
        'guaranteed to be usable in PostgreSQL?',
      choices: ['WHERE', 'GROUP BY', 'HAVING', 'ORDER BY'],
      answerIndex: 3,
      themes: ['logical-eval-order', 'portability'],
      // Pin that ORDER BY on an alias really works, and that WHERE on the same alias does not
      // (the WHERE failure is already pinned as q1's authored sqlState).
      verify: [
        {
          sql: `SELECT string_agg(id::text, ',') FROM (SELECT id, price * 2 AS dp FROM products ORDER BY dp DESC LIMIT 3) t`,
          equals: '2,1,3',
        },
      ],
      reveal: {
        correct: 'ORDER BY — it is evaluated after SELECT, so the alias exists by the time it runs.',
        why:
          'Only ORDER BY is guaranteed. It is the one clause in the list that runs *after* SELECT ' +
          'has computed the output columns and bound their aliases, so the name is available. ' +
          'WHERE, GROUP BY and HAVING all run before SELECT, so none of them can see an alias in ' +
          'standard SQL. Worth knowing for portability: PostgreSQL grants an extension for ' +
          'GROUP BY, which does accept an output alias, but this is not standard and does not ' +
          'carry across engines — relying on it makes the query non-portable, which is why the ' +
          'guaranteed answer is ORDER BY.',
        distractors: [
          'WHERE runs before SELECT — this is exactly the 42703 "column does not exist" error.',
          'GROUP BY runs before SELECT; PostgreSQL happens to allow an alias here as a non-standard extension, so it is not guaranteed.',
          'HAVING runs before SELECT and filters groups; use the aggregate expression itself, not an output alias.',
        ],
        reproduceSql:
          `SELECT id, price * 2 AS dp FROM products ORDER BY dp DESC LIMIT 3;   -- alias works here`,
      },
    },
    {
      id: 'q4',
      kind: 'write-query',
      prompt:
        'Using `orders`, return each `status` and its order count as `n`, but consider only ' +
        'orders that are not `cancelled`, and keep only the statuses with more than one order. ' +
        'Sort by `n` descending, then `status` ascending.',
      referenceSql: `SELECT status, count(*) AS n FROM orders WHERE status <> 'cancelled' GROUP BY status HAVING count(*) > 1 ORDER BY n DESC, status`,
      compare: { orderMatters: true },
      themes: ['logical-eval-order', 'set-based-thinking'],
      // orderMatters needs a total order: (n DESC, status) is unique since status is the group key.
      // The reveal names the three surviving groups and notes cancelled had only one order anyway.
      verify: [
        {
          sql: `SELECT string_agg(status || ':' || n::text, ',' ORDER BY n DESC, status) FROM (SELECT status, count(*) AS n FROM orders WHERE status <> 'cancelled' GROUP BY status HAVING count(*) > 1) t`,
          equals: 'delivered:4,paid:2,shipped:2',
        },
        { sql: `SELECT count(*)::text FROM orders WHERE status = 'cancelled'`, equals: '1' },
      ],
      reveal: {
        correct:
          `SELECT status, count(*) AS n\nFROM orders\nWHERE status <> 'cancelled'\nGROUP BY status\nHAVING count(*) > 1\nORDER BY n DESC, status;`,
        why:
          'This uses every stage of the order in its proper place. WHERE drops individual ' +
          'cancelled rows *before* grouping — the cheap place to do it, since those rows never ' +
          'enter the grouping work. GROUP BY then collapses what survives into one group per ' +
          'status, HAVING discards whole groups whose count is 1, and ORDER BY sorts the finished ' +
          'output, where the alias `n` is legal. The result is delivered (4), paid (2), shipped ' +
          '(2). Note the WHERE was not strictly load-bearing here — cancelled has only one order, ' +
          'so HAVING would have removed that group anyway — but filtering rows early is the habit ' +
          'that scales.',
        reproduceSql:
          `SELECT status, count(*) AS n\nFROM orders\nWHERE status <> 'cancelled'\nGROUP BY status\nHAVING count(*) > 1\nORDER BY n DESC, status;`,
      },
    },
  ],
};
