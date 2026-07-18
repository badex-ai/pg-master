/**
 * Tier 1 · Unit 1.5 — Joins.
 *
 * INNER / LEFT / FULL OUTER joins, ON-predicate vs WHERE-filter (and why moving a condition to
 * WHERE collapses an outer join), and cardinality fan-out. Dataset centrepieces: order 101 has
 * 2 order_items and 3 shipments (joining both fans out 2×3 = 6 rows and inflates SUM(total));
 * orders 104/105/106/108 have zero shipments (LEFT JOIN NULLs); the guest order 105 has a NULL
 * user_id (LEFT JOIN users → unmatched). Runs against the base seed.
 */

import type { Lesson } from '@/lib/content/types';

export const tier1Joins: Lesson = {
  id: 'tier1.joins',
  unit: '1.5',
  tier: 1,
  title: 'Joins',
  teach: `## Combining rows across tables

A join matches rows from two tables on a predicate (\`ON\`).

- **INNER JOIN** keeps only pairs that match on both sides.
- **LEFT JOIN** keeps every left row; where the right has no match, its columns are NULL.
- **FULL OUTER JOIN** keeps unmatched rows from *both* sides, filling the other with NULLs.

**ON vs WHERE — the outer-join trap.** In an outer join, the \`ON\` predicate decides what
*matches*; the \`WHERE\` filters the *result*. A condition on the outer (right) table that you
move from \`ON\` into \`WHERE\` **collapses the LEFT JOIN into an INNER JOIN**: the NULL-filled
unmatched rows fail the WHERE test and vanish. Keep right-side conditions in \`ON\`; keep
left-side filters in \`WHERE\`.

**Fan-out (cardinality inflation).** A join multiplies rows when the "one" side matches many on
the "many" side. Join a table to *two* independent one-to-many children and the row count is the
**product** of the two child counts — and any aggregate over the parent (\`SUM(parent.total)\`)
is now counted that many times, reading far too high. This is the single most common source of
"our revenue numbers are wrong" bugs. The fix is to aggregate each child *before* joining
(subqueries/CTEs), not to \`SELECT DISTINCT\` the mess away.`,
  exampleSql: `SELECT o.id, o.total, u.full_name
FROM orders o
LEFT JOIN users u ON u.id = o.user_id
ORDER BY o.id;`,
  questions: [
    {
      id: 'q1',
      kind: 'predict-output',
      prompt:
        'Order 101 has 2 rows in `order_items` and 3 rows in `shipments`. Joining an order to ' +
        'BOTH children at once fans out. Predict the single number returned:\n\n' +
        '```sql\nSELECT count(*)\nFROM orders o\n' +
        'JOIN order_items oi ON oi.order_id = o.id\n' +
        'JOIN shipments s ON s.order_id = o.id\n' +
        'WHERE o.id = 101;\n```',
      sql: `SELECT count(*) FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN shipments s ON s.order_id = o.id WHERE o.id = 101`,
      // 2 items × 3 shipments = 6.
      expected: { rows: [[6]] },
      themes: ['selectivity-cardinality', 'set-based-thinking'],
      verify: [
        { sql: `SELECT count(*)::text FROM order_items WHERE order_id = 101`, equals: '2' },
        { sql: `SELECT count(*)::text FROM shipments WHERE order_id = 101`, equals: '3' },
        {
          sql: `SELECT count(*)::text FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN shipments s ON s.order_id = o.id WHERE o.id = 101`,
          equals: '6',
        },
      ],
      reveal: {
        correct: '6 rows.',
        why:
          'Order 101 matches 2 order_items and, independently, 3 shipments. The two joins produce ' +
          'every combination — a cartesian product per order — so 2 × 3 = 6 rows for this one ' +
          'order. If you now wrote SUM(o.total), the order\'s 1418.99 total would be added 6 times ' +
          '(≈8514), massively overstated. That is the fan-out trap: aggregate each child separately ' +
          'before joining, rather than summing across a fanned-out result.',
        reproduceSql:
          `SELECT o.id, oi.id AS item_id, s.id AS shipment_id\n` +
          `FROM orders o\n` +
          `JOIN order_items oi ON oi.order_id = o.id\n` +
          `JOIN shipments s ON s.order_id = o.id\n` +
          `WHERE o.id = 101\n` +
          `ORDER BY item_id, shipment_id;`,
      },
    },
    {
      id: 'q2',
      kind: 'predict-output',
      prompt:
        'Four orders (104, 105, 106, 108) have no shipments at all. Predict how many rows this ' +
        'LEFT JOIN returns:\n\n' +
        '```sql\nSELECT count(*)\nFROM orders o\n' +
        'LEFT JOIN shipments s ON s.order_id = o.id;\n```',
      sql: `SELECT count(*) FROM orders o LEFT JOIN shipments s ON s.order_id = o.id`,
      // 10 shipments match their orders; the 4 shipment-less orders each contribute one NULL-filled
      // row. Orders with shipments: 101(3)+102(1)+103(2)+107(2)+109(1)+110(1) = 10 matched rows,
      // plus 4 unmatched = 14.
      expected: { rows: [[14]] },
      themes: ['set-based-thinking', 'null-correctness'],
      verify: [
        { sql: `SELECT count(*)::text FROM shipments`, equals: '10' },
        {
          sql: `SELECT count(*)::text FROM orders o WHERE NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)`,
          equals: '4',
        },
        {
          sql: `SELECT count(*)::text FROM orders o LEFT JOIN shipments s ON s.order_id = o.id`,
          equals: '14',
        },
      ],
      reveal: {
        correct: '14 rows.',
        why:
          'A LEFT JOIN emits one row per matched pair plus one NULL-filled row for each left row ' +
          'with no match. The 10 shipments each match their order (10 rows), and the 4 shipment-' +
          'less orders (104, 105, 106, 108) each add one row with all shipment columns NULL: ' +
          '10 + 4 = 14. An INNER JOIN would drop those four and return only 10.',
        reproduceSql:
          `SELECT o.id AS order_id, s.id AS shipment_id, s.carrier\n` +
          `FROM orders o LEFT JOIN shipments s ON s.order_id = o.id\n` +
          `ORDER BY o.id, s.id;`,
      },
    },
    {
      id: 'q3',
      kind: 'multiple-choice',
      prompt:
        'You want every order with its shipments, but only DHL shipments shown — and orders with ' +
        'no DHL shipment must STILL appear (with NULLs). Which query is correct?',
      choices: [
        `SELECT o.id, s.carrier FROM orders o LEFT JOIN shipments s ON s.order_id = o.id AND s.carrier = 'DHL'`,
        `SELECT o.id, s.carrier FROM orders o LEFT JOIN shipments s ON s.order_id = o.id WHERE s.carrier = 'DHL'`,
        `SELECT o.id, s.carrier FROM orders o INNER JOIN shipments s ON s.order_id = o.id WHERE s.carrier = 'DHL'`,
        `SELECT o.id, s.carrier FROM orders o LEFT JOIN shipments s ON s.order_id = o.id WHERE s.carrier = 'DHL' OR s.carrier IS NULL`,
      ],
      answerIndex: 0,
      themes: ['null-correctness', 'logical-eval-order'],
      // The distinction: carrier='DHL' in ON keeps all orders (LEFT preserved); in WHERE it
      // collapses to INNER. Pin: there are DHL shipments (4, on orders 101 and 107), and 8 orders
      // have none — so the ON-form keeps all 10 orders while the WHERE-form would keep only 2.
      verify: [
        { sql: `SELECT count(*)::text FROM shipments WHERE carrier = 'DHL'`, equals: '4' },
        {
          sql: `SELECT count(*)::text FROM orders o LEFT JOIN shipments s ON s.order_id = o.id AND s.carrier = 'DHL' WHERE s.id IS NULL`,
          equals: '8',
        },
      ],
      reveal: {
        correct: `Put the carrier test in ON: LEFT JOIN … ON s.order_id = o.id AND s.carrier = 'DHL'.`,
        why:
          'The carrier condition belongs in ON because it decides what the outer join *matches*. ' +
          'With it in ON, every order is still preserved; only non-DHL shipments are treated as ' +
          'non-matches (NULL-filled). Move that same condition to WHERE and it filters the *result* ' +
          'after the join — the NULL-filled rows have carrier = NULL, fail `carrier = \'DHL\'`, and ' +
          'are dropped, silently collapsing the LEFT JOIN into an INNER JOIN.',
        distractors: [
          'carrier in WHERE drops the NULL-filled rows, turning the LEFT JOIN into an INNER JOIN.',
          'INNER JOIN never keeps orders without a matching DHL shipment in the first place.',
          '`OR s.carrier IS NULL` re-adds unmatched orders but ALSO keeps rows where a real shipment had a NULL carrier — a different, leakier result than putting the test in ON.',
        ],
        reproduceSql:
          `SELECT o.id, s.carrier\n` +
          `FROM orders o LEFT JOIN shipments s ON s.order_id = o.id AND s.carrier = 'DHL'\n` +
          `ORDER BY o.id, s.id;`,
      },
    },
    {
      id: 'q4',
      kind: 'write-query',
      prompt:
        'List every order id alongside the buyer\'s `full_name`. The guest order (NULL user_id) ' +
        'must still appear, with a NULL name. Return `order_id` and `full_name`. ' +
        'Names and values matter; row order does not.',
      referenceSql: `SELECT o.id AS order_id, u.full_name FROM orders o LEFT JOIN users u ON u.id = o.user_id`,
      themes: ['null-correctness', 'set-based-thinking'],
      // The reveal claims all 10 orders appear (LEFT preserves the guest order) and exactly one has
      // no user. Pin: 10 orders, one NULL user_id, and the LEFT JOIN yields exactly 10 rows (no
      // fan-out, since user_id → users is many-to-one).
      verify: [
        { sql: `SELECT count(*)::text FROM orders`, equals: '10' },
        { sql: `SELECT count(*)::text FROM orders WHERE user_id IS NULL`, equals: '1' },
        {
          sql: `SELECT count(*)::text FROM orders o LEFT JOIN users u ON u.id = o.user_id`,
          equals: '10',
        },
      ],
      reveal: {
        correct: `SELECT o.id AS order_id, u.full_name FROM orders o LEFT JOIN users u ON u.id = o.user_id;`,
        why:
          'LEFT JOIN keeps all 10 orders. Nine match a user and show that user\'s name; the guest ' +
          'order (105, user_id NULL) matches no user, so u.full_name is NULL for it. The row count ' +
          'stays 10 because each order references at most one user (many-to-one) — no fan-out. An ' +
          'INNER JOIN would drop the guest order, and NOT IN-style NULL logic is not even in play ' +
          'here: the join predicate `u.id = NULL` simply never matches, which LEFT JOIN handles.',
        reproduceSql:
          `SELECT o.id AS order_id, o.user_id, u.full_name\n` +
          `FROM orders o LEFT JOIN users u ON u.id = o.user_id\n` +
          `ORDER BY o.id;`,
      },
    },
  ],
};
