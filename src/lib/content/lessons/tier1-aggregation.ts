/**
 * Tier 1 · Unit 1.4 — Aggregation.
 *
 * COUNT(*) vs COUNT(col) vs COUNT(DISTINCT), SUM/AVG ignoring NULL, GROUP BY (one row per group),
 * HAVING vs WHERE, and the FILTER (WHERE …) clause. Dataset hooks: the payments charge+refund on
 * order 106 (SUM net vs gross), shipped_at NULLs (COUNT skips them), and user 1's three orders
 * (GROUP BY). Runs against the base seed.
 */

import type { Lesson } from '@/lib/content/types';

export const tier1Aggregation: Lesson = {
  id: 'tier1.aggregation',
  unit: '1.4',
  tier: 1,
  title: 'Aggregation',
  teach: `## Collapsing rows into summaries

An aggregate reads many rows and returns one value. Without \`GROUP BY\` the whole table is one
group; with it, one output row per distinct group.

**COUNT has three forms, and they differ:**

- \`COUNT(*)\` counts rows, NULLs included.
- \`COUNT(col)\` counts rows where \`col\` is **not** NULL — it skips NULLs.
- \`COUNT(DISTINCT col)\` counts distinct non-NULL values.

\`SUM\`, \`AVG\`, \`MIN\`, \`MAX\` also **ignore NULLs**. That matters: \`AVG(col)\` divides by the
count of non-NULL values, not by the row count — a NULL is not a zero.

**GROUP BY.** Every column in the SELECT list must either be in the \`GROUP BY\` or wrapped in an
aggregate — otherwise Postgres rejects the query, because the value would be ambiguous per group.

**WHERE vs HAVING.** \`WHERE\` filters *rows before* grouping; \`HAVING\` filters *groups after*
aggregation. A condition on an aggregate (\`SUM(...) > 100\`) belongs in HAVING — it can't go in
WHERE, which runs before the aggregate exists.

**FILTER.** \`agg(...) FILTER (WHERE cond)\` aggregates only the rows matching \`cond\`, so you can
compute several differently-filtered aggregates in one pass:

\`\`\`sql
SELECT count(*) AS all_orders,
       count(*) FILTER (WHERE status = 'delivered') AS delivered
FROM orders;
\`\`\``,
  exampleSql: `SELECT status, count(*) AS n, sum(total) AS revenue
FROM orders
GROUP BY status
ORDER BY status;`,
  questions: [
    {
      id: 'q1',
      kind: 'predict-output',
      prompt:
        'Orders 104, 105, 106, 108 have a NULL `shipped_at` (never shipped); the other six have a ' +
        'value. Predict the two counts:\n\n' +
        '```sql\nSELECT count(*) AS rows, count(shipped_at) AS shipped FROM orders;\n```',
      sql: `SELECT count(*) AS rows, count(shipped_at) AS shipped FROM orders`,
      expected: { columns: ['rows', 'shipped'], rows: [[10, 6]] },
      themes: ['null-correctness'],
      verify: [
        { sql: `SELECT count(*)::text FROM orders`, equals: '10' },
        { sql: `SELECT count(shipped_at)::text FROM orders`, equals: '6' },
        { sql: `SELECT count(*)::text FROM orders WHERE shipped_at IS NULL`, equals: '4' },
      ],
      reveal: {
        correct: 'rows = 10, shipped = 6.',
        why:
          'COUNT(*) counts every order (10). COUNT(shipped_at) counts only orders whose shipped_at ' +
          'is non-NULL, skipping the four unshipped ones (104, 105, 106, 108), leaving 6. The gap ' +
          'between the two counts is exactly the NULL count — this is how you count "how many have ' +
          'a value" without a WHERE clause.',
        reproduceSql:
          `SELECT count(*) AS rows, count(shipped_at) AS shipped,\n` +
          `       count(*) - count(shipped_at) AS unshipped\n` +
          `FROM orders;`,
      },
    },
    {
      id: 'q2',
      kind: 'predict-output',
      prompt:
        'Order 106 has two payments: a 149.49 charge and a -149.49 refund (net zero). ' +
        'Predict the gross and net totals for order 106:\n\n' +
        '```sql\nSELECT sum(amount) AS net,\n' +
        '       sum(amount) FILTER (WHERE amount > 0) AS gross\n' +
        'FROM payments WHERE order_id = 106;\n```',
      sql: `SELECT sum(amount) AS net, sum(amount) FILTER (WHERE amount > 0) AS gross FROM payments WHERE order_id = 106`,
      expected: { columns: ['net', 'gross'], rows: [[0, 149.49]] },
      themes: ['null-correctness', 'set-based-thinking'],
      verify: [
        { sql: `SELECT sum(amount)::text FROM payments WHERE order_id = 106`, equals: '0.00' },
        { sql: `SELECT sum(amount)::text FROM payments WHERE order_id = 106 AND amount > 0`, equals: '149.49' },
        { sql: `SELECT count(*)::text FROM payments WHERE order_id = 106`, equals: '2' },
      ],
      reveal: {
        correct: 'net = 0.00, gross = 149.49.',
        why:
          'SUM(amount) adds the charge (+149.49) and the refund (-149.49) to 0.00 — the net. ' +
          'The FILTER restricts the same SUM to positive rows only, giving the gross charge ' +
          '(149.49) before the refund. FILTER lets one query report both figures in a single pass ' +
          'over the group, instead of two separate queries or a CASE-inside-SUM.',
        reproduceSql:
          `SELECT sum(amount) AS net,\n` +
          `       sum(amount) FILTER (WHERE amount > 0) AS gross,\n` +
          `       sum(amount) FILTER (WHERE amount < 0) AS refunds\n` +
          `FROM payments WHERE order_id = 106;`,
      },
    },
    {
      id: 'q3',
      kind: 'write-query',
      prompt:
        'For each user who has placed at least one order, return their `user_id` and their number ' +
        'of orders (`order_count`). Exclude guest orders (NULL user_id). Names and values matter; ' +
        'row order does not.',
      referenceSql: `SELECT user_id, count(*) AS order_count FROM orders WHERE user_id IS NOT NULL GROUP BY user_id`,
      themes: ['set-based-thinking', 'null-correctness'],
      // The reveal says user 1 has 3 orders (the max) and the guest order is excluded. Pin: user 1's
      // count is 3, exactly one order has NULL user_id, and the distinct real users = group count.
      verify: [
        { sql: `SELECT count(*)::text FROM orders WHERE user_id = 1`, equals: '3' },
        { sql: `SELECT count(*)::text FROM orders WHERE user_id IS NULL`, equals: '1' },
        { sql: `SELECT count(DISTINCT user_id)::text FROM orders WHERE user_id IS NOT NULL`, equals: '6' },
      ],
      reveal: {
        correct: `SELECT user_id, count(*) AS order_count FROM orders WHERE user_id IS NOT NULL GROUP BY user_id;`,
        why:
          'GROUP BY user_id makes one row per user; COUNT(*) counts that group\'s orders. WHERE ' +
          'user_id IS NOT NULL drops the guest order (105) *before* grouping — put in WHERE, not ' +
          'HAVING, because it filters rows, not aggregated groups. Six users qualify; user 1 has the ' +
          'most at 3 (orders 101, 102, 108). Note GROUP BY would also make a NULL its own group, ' +
          'which is why the guest order is excluded explicitly.',
        reproduceSql:
          `SELECT user_id, count(*) AS order_count\n` +
          `FROM orders WHERE user_id IS NOT NULL\n` +
          `GROUP BY user_id ORDER BY order_count DESC;`,
      },
    },
    {
      id: 'q4',
      kind: 'predict-error',
      prompt:
        'Does this run? If not, why?\n\n' +
        '```sql\nSELECT status, total FROM orders GROUP BY status;\n```',
      sql: `SELECT status, total FROM orders GROUP BY status`,
      runs: false,
      // "column must appear in GROUP BY or aggregate" = grouping error, SQLSTATE 42803.
      sqlState: '42803',
      themes: ['set-based-thinking', 'logical-eval-order'],
      reveal: {
        correct: 'It errors — `total` is neither grouped nor aggregated.',
        why:
          'GROUP BY status collapses each status into one row, but `total` has many different ' +
          'values within a status group, so Postgres can\'t pick one — it raises "column ' +
          '\\"orders.total\\" must appear in the GROUP BY clause or be used in an aggregate ' +
          'function" (SQLSTATE 42803). Either aggregate it (`sum(total)`, `max(total)`) or add it ' +
          'to GROUP BY. This rule is what makes a grouped row well-defined.',
        reproduceSql: `SELECT status, sum(total) AS revenue FROM orders GROUP BY status;`,
      },
    },
  ],
};
