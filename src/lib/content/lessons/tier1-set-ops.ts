/**
 * Tier 1 · Unit 1.6 — Set operations.
 *
 * UNION / UNION ALL / INTERSECT / EXCEPT, their ALL variants, and the two rules that bite:
 * set operators compare NULL as a *value* (unlike `=`, and unlike NOT IN), and the operators
 * chain left-to-right with INTERSECT binding tighter than UNION/EXCEPT.
 *
 * Dataset centrepieces: `orders.user_id` contains a NULL (guest order 105), so
 * `orders.user_id EXCEPT reviews.user_id` returns {9, NULL} where the NOT IN spelling returns
 * only {9}; user 1 has 3 orders but 2 reviews, so EXCEPT ALL leaves one copy behind; products
 * 7/9/10 were never ordered and never reviewed. Runs against the base seed.
 */

import type { Lesson } from '@/lib/content/types';

export const tier1SetOps: Lesson = {
  id: 'tier1.set-ops',
  unit: '1.6',
  tier: 1,
  title: 'Set operations',
  teach: `## Stacking result sets vertically

A join widens rows — it adds *columns*. A set operator stacks result sets — it adds *rows*.
Both sides must have the same number of columns and compatible types, matched **by position,
not by name**; the output takes its column names from the first branch.

- **UNION ALL** — concatenate both sides. Keeps every duplicate. No sorting, no hashing, no work.
- **UNION** — concatenate, then remove duplicate rows.
- **INTERSECT** — rows appearing in both sides.
- **EXCEPT** — rows in the left side that do not appear in the right side.

The three deduplicating operators each have an **ALL** variant that keeps multiplicity instead
of collapsing it. \`INTERSECT ALL\` emits each row min(left count, right count) times;
\`EXCEPT ALL\` emits it max(left − right, 0) times. Reach for \`UNION ALL\` by default: plain
\`UNION\` silently pays for a dedupe you usually did not ask for, and if the branches cannot
produce duplicates it buys nothing.

**NULL is a value here.** Everywhere else in SQL, \`NULL = NULL\` is UNKNOWN. Set operators
instead use *not distinct* comparison: two NULLs match each other. That makes \`EXCEPT\` the
NULL-safe way to spell "in the left set but not the right" — it is where \`NOT IN\` throws away
your whole result the moment the right side contains one NULL.

**Precedence and chaining.** \`INTERSECT\` binds tighter than \`UNION\` and \`EXCEPT\`; equal
operators chain **left to right**. So \`a EXCEPT b UNION c\` means \`(a EXCEPT b) UNION c\`, which
is not what most people read it as. Parenthesize whenever you mix operators.

**ORDER BY belongs to the whole statement**, not to a branch — it goes once, at the end, and can
only reference the *first* branch's output names (or an output-column position).`,
  exampleSql: `SELECT user_id FROM orders
EXCEPT
SELECT user_id FROM reviews;`,
  questions: [
    {
      id: 'q1',
      kind: 'predict-output',
      prompt:
        'Users 1, 2, 3, 5, 7 and 9 have placed orders; users 1, 2, 3, 5 and 7 have written ' +
        'reviews. One order (105, the guest order) has a NULL `user_id`. Predict the rows:\n\n' +
        '```sql\nSELECT user_id FROM orders\nEXCEPT\nSELECT user_id FROM reviews;\n```',
      sql: `SELECT user_id FROM orders EXCEPT SELECT user_id FROM reviews`,
      // {9, NULL}: user 9 ordered but never reviewed, and the guest order's NULL user_id has no
      // NULL counterpart on the reviews side (reviews.user_id is NOT NULL), so it survives.
      expected: { rows: [[9], [null]] },
      themes: ['null-correctness', 'set-based-thinking'],
      verify: [
        {
          sql: `SELECT string_agg(DISTINCT user_id::text, ',' ORDER BY user_id::text) FROM orders WHERE user_id IS NOT NULL`,
          equals: '1,2,3,5,7,9',
        },
        {
          sql: `SELECT string_agg(DISTINCT user_id::text, ',' ORDER BY user_id::text) FROM reviews`,
          equals: '1,2,3,5,7',
        },
        { sql: `SELECT count(*)::text FROM orders WHERE user_id IS NULL`, equals: '1' },
        {
          sql: `SELECT string_agg(coalesce(user_id::text, 'NULL'), ',' ORDER BY user_id NULLS LAST) FROM (SELECT user_id FROM orders EXCEPT SELECT user_id FROM reviews) t`,
          equals: '9,NULL',
        },
      ],
      reveal: {
        correct: 'Two rows: 9 and NULL.',
        why:
          'User 9 placed an order and never reviewed anything, so it survives the subtraction. ' +
          'The second row is the interesting one: the guest order contributes a NULL user_id, and ' +
          'set operators compare rows with *not distinct* semantics rather than `=`. The question ' +
          'EXCEPT asks is "is there a NULL on the right side to cancel this one?" — reviews.user_id ' +
          'is NOT NULL, so there is not, and the NULL row is kept. EXCEPT also deduplicates: user 1 ' +
          'has three orders, but that has no bearing here since user 1 is cancelled out entirely.',
        reproduceSql:
          `SELECT user_id FROM orders\nEXCEPT\nSELECT user_id FROM reviews\nORDER BY user_id NULLS LAST;`,
      },
    },
    {
      id: 'q2',
      kind: 'multiple-choice',
      prompt:
        'Someone rewrites that EXCEPT as a `NOT IN` subquery:\n\n' +
        '```sql\nSELECT DISTINCT user_id FROM orders\nWHERE user_id NOT IN (SELECT user_id FROM reviews);\n```\n\n' +
        'How does its result differ from the EXCEPT version?',
      choices: [
        'It returns one row (9) instead of two — the NULL user_id is dropped.',
        'It returns the same two rows; the two spellings are equivalent.',
        'It returns zero rows, because reviews.user_id contains a NULL.',
        'It raises an error, because NOT IN cannot be applied to a nullable column.',
      ],
      answerIndex: 0,
      themes: ['null-correctness', 'set-based-thinking'],
      verify: [
        {
          sql: `SELECT count(*)::text FROM (SELECT DISTINCT user_id FROM orders WHERE user_id NOT IN (SELECT user_id FROM reviews)) t`,
          equals: '1',
        },
        {
          sql: `SELECT count(*)::text FROM (SELECT user_id FROM orders EXCEPT SELECT user_id FROM reviews) t`,
          equals: '2',
        },
        { sql: `SELECT count(*)::text FROM reviews WHERE user_id IS NULL`, equals: '0' },
      ],
      reveal: {
        correct: 'One row (9). The NULL user_id disappears.',
        why:
          'The two constructs disagree about NULL on the *left*. For the guest order, the predicate ' +
          'is `NULL NOT IN (1,2,3,5,7)`, which evaluates to UNKNOWN — not TRUE — so WHERE rejects the ' +
          'row. EXCEPT, comparing with not-distinct semantics, keeps it. Note this seed lets NOT IN ' +
          'off lightly: reviews.user_id is NOT NULL. Had the *right* side contained a single NULL, ' +
          'every remaining row would evaluate to UNKNOWN too and the query would return nothing at ' +
          'all — the classic NOT IN wipeout.',
        distractors: [
          'The two are only equivalent when neither side can produce a NULL; here the left side does.',
          'The wipeout-to-zero failure needs a NULL on the *right* (inside the subquery); reviews.user_id is NOT NULL, so rows with a real user id still resolve normally.',
          'NOT IN over a nullable column is perfectly legal SQL — that is exactly why the bug is so easy to ship: it fails silently, not loudly.',
        ],
        reproduceSql:
          `SELECT DISTINCT user_id FROM orders\n` +
          `WHERE user_id NOT IN (SELECT user_id FROM reviews)\n` +
          `ORDER BY user_id NULLS LAST;`,
      },
    },
    {
      id: 'q3',
      kind: 'predict-output',
      prompt:
        'User 1 has 3 orders and 2 reviews; user 2 has 2 orders and 3 reviews; users 3, 5 and 7 ' +
        'each have at least one of both. Predict the single number:\n\n' +
        '```sql\nSELECT count(*) FROM (\n  SELECT user_id FROM orders\n  INTERSECT ALL\n' +
        '  SELECT user_id FROM reviews\n) t;\n```',
      sql: `SELECT count(*) FROM (SELECT user_id FROM orders INTERSECT ALL SELECT user_id FROM reviews) t`,
      // min() per user: 1→min(3,2)=2, 2→min(2,3)=2, 3→min(1,2)=1, 5→min(1,1)=1, 7→min(1,2)=1 = 7.
      expected: { rows: [[7]] },
      themes: ['set-based-thinking'],
      verify: [
        {
          sql: `SELECT string_agg(user_id::text || ':' || c::text, ',' ORDER BY user_id) FROM (SELECT user_id, count(*) c FROM orders WHERE user_id IS NOT NULL GROUP BY user_id) t`,
          equals: '1:3,2:2,3:1,5:1,7:1,9:1',
        },
        {
          sql: `SELECT string_agg(user_id::text || ':' || c::text, ',' ORDER BY user_id) FROM (SELECT user_id, count(*) c FROM reviews GROUP BY user_id) t`,
          equals: '1:2,2:3,3:2,5:1,7:2',
        },
        {
          sql: `SELECT count(*)::text FROM (SELECT user_id FROM orders INTERSECT ALL SELECT user_id FROM reviews) t`,
          equals: '7',
        },
        {
          sql: `SELECT count(*)::text FROM (SELECT user_id FROM orders INTERSECT SELECT user_id FROM reviews) t`,
          equals: '5',
        },
      ],
      reveal: {
        correct: '7 rows.',
        why:
          'INTERSECT ALL keeps a row min(left multiplicity, right multiplicity) times rather than ' +
          'collapsing it to one. User 1: min(3 orders, 2 reviews) = 2. User 2: min(2, 3) = 2. Users ' +
          '3, 5 and 7 each contribute min(…) = 1. That is 2 + 2 + 1 + 1 + 1 = 7. Plain INTERSECT ' +
          'would return 5 — one row per user id. User 9 and the NULL appear on only one side, so ' +
          'min is 0 for both and neither survives.',
        reproduceSql:
          `SELECT user_id FROM orders\nINTERSECT ALL\nSELECT user_id FROM reviews\nORDER BY user_id;`,
      },
    },
    {
      id: 'q4',
      kind: 'multiple-choice',
      prompt:
        'You want products that were **never ordered and never reviewed**. A colleague writes:\n\n' +
        '```sql\nSELECT id FROM products\nEXCEPT\nSELECT product_id FROM order_items\n' +
        'UNION\nSELECT product_id FROM reviews;\n```\n\n' +
        'It returns all 10 product ids. Why?',
      choices: [
        'Equal-precedence operators chain left to right, so it computes `(products EXCEPT order_items) UNION reviews` — the UNION adds the reviewed products back.',
        'UNION binds tighter than EXCEPT, so it computes `products EXCEPT (order_items UNION reviews)` and that set happens to be all 10.',
        'EXCEPT and UNION cancel each other out, so the statement degenerates to `SELECT id FROM products`.',
        'The branches select different column names (`id` vs `product_id`), so Postgres falls back to returning the first branch unchanged.',
      ],
      answerIndex: 0,
      themes: ['set-based-thinking', 'logical-eval-order'],
      verify: [
        {
          sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM (SELECT id FROM products EXCEPT SELECT product_id FROM order_items UNION SELECT product_id FROM reviews) t`,
          equals: '1,2,3,4,5,6,7,8,9,10',
        },
        {
          sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM (SELECT id FROM products EXCEPT (SELECT product_id FROM order_items UNION SELECT product_id FROM reviews)) t`,
          equals: '7,9,10',
        },
        {
          sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM (SELECT id FROM products EXCEPT SELECT product_id FROM order_items) t`,
          equals: '7,8,9,10',
        },
        {
          sql: `SELECT string_agg(DISTINCT product_id::text, ',' ORDER BY product_id::text) FROM reviews`,
          equals: '1,2,3,4,5,6,8',
        },
      ],
      reveal: {
        correct:
          'It parses as `(products EXCEPT order_items) UNION reviews` — left-to-right — and the ' +
          'UNION puts the reviewed products straight back.',
        why:
          'UNION and EXCEPT have equal precedence and associate left to right, so the EXCEPT runs ' +
          'first and yields {7, 8, 9, 10}. Unioning the reviewed products {1,2,3,4,5,6,8} onto that ' +
          'result restores everything, giving all 10 ids. The intended query needs explicit ' +
          'parentheses — `SELECT id FROM products EXCEPT (SELECT product_id FROM order_items UNION ' +
          'SELECT product_id FROM reviews)` — or a chained subtraction, `… EXCEPT … EXCEPT …`. Both ' +
          'return {7, 9, 10}. Note that INTERSECT is the one exception to equal precedence: it binds ' +
          'tighter than both.',
        distractors: [
          'UNION does not bind tighter than EXCEPT; they are equal precedence. Only INTERSECT binds tighter.',
          'Set operators never cancel out — each one is applied in turn to the accumulated result.',
          'Column names are irrelevant to set operators: branches are matched by position, and the output simply inherits the first branch\'s names.',
        ],
        reproduceSql:
          `SELECT id FROM products\nEXCEPT\n(SELECT product_id FROM order_items\n UNION\n SELECT product_id FROM reviews)\nORDER BY id;`,
      },
    },
    {
      id: 'q5',
      kind: 'write-query',
      prompt:
        'Build a single-column list of every distinct place name mentioned in `users` — both ' +
        'countries and cities — with no duplicates. Name the column `place`. ' +
        'Values matter; row order does not.',
      referenceSql: `SELECT country AS place FROM users UNION SELECT city FROM users`,
      themes: ['set-based-thinking'],
      // 4 distinct countries + 8 distinct cities, disjoint (INTERSECT is empty) = 12 rows.
      verify: [
        { sql: `SELECT count(DISTINCT country)::text FROM users`, equals: '4' },
        { sql: `SELECT count(DISTINCT city)::text FROM users`, equals: '8' },
        {
          sql: `SELECT count(*)::text FROM (SELECT country FROM users INTERSECT SELECT city FROM users) t`,
          equals: '0',
        },
        {
          sql: `SELECT count(*)::text FROM (SELECT country FROM users UNION SELECT city FROM users) t`,
          equals: '12',
        },
        {
          sql: `SELECT count(*)::text FROM (SELECT country FROM users UNION ALL SELECT city FROM users) t`,
          equals: '20',
        },
      ],
      reveal: {
        correct: `SELECT country AS place FROM users UNION SELECT city FROM users;`,
        why:
          'UNION stacks the two single-column result sets and removes duplicates, giving 12 rows: ' +
          '4 distinct countries and 8 distinct cities, with no name appearing in both lists. ' +
          'UNION ALL would return 20 — ten rows from each branch, duplicates and all — so here the ' +
          'dedupe is the whole point of the query and UNION is the right default, unusually. The ' +
          'alias goes on the *first* branch: the output column name always comes from branch one, ' +
          'and aliasing the second branch instead would leave the column called `country`.',
        reproduceSql:
          `SELECT country AS place FROM users\nUNION\nSELECT city FROM users\nORDER BY place;`,
      },
    },
    {
      id: 'q6',
      kind: 'predict-error',
      prompt:
        'Does this run? If not, what stops it?\n\n' +
        '```sql\nSELECT country FROM users\nUNION\nSELECT city AS c FROM users\nORDER BY c;\n```',
      sql: `SELECT country FROM users UNION SELECT city AS c FROM users ORDER BY c`,
      runs: false,
      sqlState: '42703',
      themes: ['set-based-thinking', 'logical-eval-order'],
      verify: [
        {
          sql: `SELECT count(*)::text FROM (SELECT country AS c FROM users UNION SELECT city FROM users ORDER BY c) t`,
          equals: '12',
        },
      ],
      reveal: {
        correct: 'It fails: `column "c" does not exist` (SQLSTATE 42703).',
        why:
          'The ORDER BY belongs to the whole set operation, not to the last branch, so it can only ' +
          'reference the output columns — and the output column names come from the **first** branch, ' +
          'which here is `country`. The alias `c` on the second branch never becomes an output name; ' +
          'it is discarded. Move the alias to the first branch (`SELECT country AS c FROM users ' +
          'UNION SELECT city FROM users ORDER BY c`) and it sorts fine, or sort by position with ' +
          '`ORDER BY 1`.',
        reproduceSql:
          `SELECT country AS c FROM users\nUNION\nSELECT city FROM users\nORDER BY c;`,
      },
    },
  ],
};
