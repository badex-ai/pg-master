/**
 * Design · Unit design.3 — Model the relationships (1:1, 1:N, M:N).
 *
 * DESIGN.md §3. Unlike design.1/design.2, this unit is fully executable: all three relationship
 * shapes exist in the seeded schema and can be proved by query rather than asserted in prose.
 *  - 1:N   → users → orders (user 1 has 3 orders; the FK sits on the many side).
 *  - M:N   → orders ↔ products via order_items (3 orders hold 2+ products; 2 products appear in
 *            2+ orders — so neither side could hold a single reference).
 *  - 1:1   → products → inventory (10 rows each, inventory.product_id is BOTH PK and FK, which is
 *            what actually enforces the "at most one" half of 1:1).
 * Note order_items uses a surrogate `id` PK rather than the composite (order_id, product_id) that
 * §3 presents as the canonical join-table shape; the lesson teaches that honestly — `reviews` is
 * the table that carries the real UNIQUE (product_id, user_id) pair constraint.
 */

import type { Lesson } from '@/lib/content/types';

export const designRelationships: Lesson = {
  id: 'design.relationships',
  unit: 'design.3',
  tier: 'design',
  title: 'Model the relationships (1:1, 1:N, M:N)',
  teach: `## Every relationship is one of three shapes

Getting the shape right is most of relational design.

### One-to-many (1:N) — the workhorse

One user has many orders; one order has many shipments. **The "many" side holds the foreign
key**: \`orders.user_id → users.id\`. You never put a list of order-ids on the user row — that is
the array-in-a-column smell, and it cannot be indexed, constrained, or joined efficiently.

**Why the FK goes on the many side:** a column holds exactly one value. The side that has *one*
parent can hold one reference. The side that has *many* children cannot hold many references in
one column.

### Many-to-many (M:N) — needs a join table

An order contains many products; a product appears in many orders. **Neither side can hold a
column pointing at the other**, so the relationship itself becomes a table whose rows are the
*pairs*: \`order_items(order_id, product_id)\`.

**The join table is a first-class citizen.** It usually grows attributes of its own — \`quantity\`
and \`unit_price\` here — which is the sign it was an entity all along.

**Enforcing "not twice".** The pair should be unique, or you can insert the same relationship
repeatedly. Some join tables declare a composite primary key \`(a_id, b_id)\`; others keep a
surrogate \`id\` and add a separate \`UNIQUE (a_id, b_id)\`. \`reviews\` in this database does
exactly that: \`UNIQUE (product_id, user_id)\` is what stops one user reviewing one product twice.
Look closely at \`order_items\` and you will find it has a surrogate key and *no* such constraint
— deliberately, since a real order may legitimately list the same product on two lines.

### One-to-one (1:1) — rarer, and usually a smell

When tempted by 1:1, ask "why isn't this just more columns on the same table?" Valid reasons to
split: **optional heavy data** you rarely read, **different access control** (PII apart from the
rest), or **different write frequency** (a hot counter split off cold data). Absent a reason, a
gratuitous 1:1 just adds a join to every query.

\`inventory\` is a defensible 1:1 with \`products\`: stock changes constantly while the product
row is nearly static. What *enforces* the shape is that \`inventory.product_id\` is both the
primary key and the foreign key — being the PK is what caps it at one row per product.

> **The test for every relationship:** can one side have *more than one* of the other? Yes in
> *both* directions → M:N join table. Yes in one direction → FK on the many side. No in both →
> same table, or a justified 1:1.`,
  exampleSql: `-- All three shapes in one query.
-- 1:N  users → orders     (many orders per user)
-- M:N  orders ↔ products  (via order_items)
-- 1:1  products → inventory
SELECT u.full_name, o.id AS order_id, p.name AS product, oi.quantity, i.stock
FROM users u
JOIN orders o       ON o.user_id    = u.id
JOIN order_items oi ON oi.order_id  = o.id
JOIN products p     ON p.id         = oi.product_id
JOIN inventory i    ON i.product_id = p.id
ORDER BY o.id, p.id;`,
  questions: [
    {
      id: 'q1',
      kind: 'predict-output',
      prompt:
        'User 1 has placed 3 orders. The foreign key `orders.user_id` sits on the **orders** side. ' +
        'Predict the single number returned:\n\n' +
        '```sql\nSELECT count(*) FROM orders WHERE user_id = 1;\n```',
      sql: `SELECT count(*) FROM orders WHERE user_id = 1`,
      expected: { rows: [[3]] },
      themes: ['set-based-thinking'],
      verify: [{ sql: `SELECT count(*)::text FROM orders WHERE user_id = 1`, equals: '3' }],
      reveal: {
        correct: '3 rows.',
        why:
          'This is the 1:N shape doing its job. Three separate order rows each carry `user_id = 1` ' +
          'in a single-valued column, so "how many orders does this user have" is an ordinary ' +
          'filter that an index on `user_id` can answer directly. Had the design instead stored ' +
          'an array of order-ids on the user row, this count would require unnesting the array, ' +
          'no foreign key could guarantee those ids point at real orders, and deleting an order ' +
          'would leave a dangling id behind with nothing to catch it.',
        reproduceSql:
          `SELECT id AS order_id, user_id, status, total\n` +
          `FROM orders WHERE user_id = 1 ORDER BY id;`,
      },
    },
    {
      id: 'q2',
      kind: 'multiple-choice',
      prompt:
        'In this database, product 4 appears in 3 different orders, and 3 different orders contain ' +
        'more than one product each. Why can this relationship **not** be modelled with a foreign ' +
        'key column on either `orders` or `products`?',
      choices: [
        'Because the "many" runs in both directions, and a column can hold only one value — so neither table can reference the other.',
        'Because `orders` and `products` have different primary key types, so a foreign key between them is impossible.',
        'Because foreign keys cannot be nullable, and some orders contain no products.',
        'Because Postgres limits a table to one outgoing foreign key per referenced table.',
      ],
      answerIndex: 0,
      themes: ['set-based-thinking'],
      verify: [
        { sql: `SELECT count(DISTINCT order_id)::text FROM order_items WHERE product_id = 4`, equals: '3' },
        {
          sql: `SELECT count(*)::text FROM (SELECT order_id FROM order_items GROUP BY 1 HAVING count(DISTINCT product_id) > 1) t`,
          equals: '3',
        },
      ],
      reveal: {
        correct:
          'The "many" runs both ways, and a column holds exactly one value, so neither side can ' +
          'reference the other.',
        why:
          'A foreign key column can express "many rows point at one parent" — that is 1:N. Here ' +
          'both directions are "many": product 4 belongs to orders 101, 102 and 106, while order ' +
          '101 holds products 1 and 4. Putting `product_id` on `orders` would cap an order at one ' +
          'product; putting `order_id` on `products` would cap a product at one order. Both are ' +
          'wrong, so the pairing itself must become rows in a third table — `order_items`.',
        distractors: [
          'Both are bigint identity keys; type is not the obstacle, and a type mismatch would be fixable by casting anyway.',
          'Foreign keys are nullable by default in Postgres — orders.user_id is a nullable FK in this very schema.',
          'No such limit exists. order_items itself holds two outgoing foreign keys, and a table may have many.',
        ],
        reproduceSql:
          `-- Many in both directions.\n` +
          `SELECT 'product 4 is in these orders' AS fact, string_agg(DISTINCT order_id::text, ', ') AS ids\n` +
          `FROM order_items WHERE product_id = 4\n` +
          `UNION ALL\n` +
          `SELECT 'order 101 holds these products', string_agg(product_id::text, ', ' ORDER BY product_id)\n` +
          `FROM order_items WHERE order_id = 101;`,
      },
    },
    {
      id: 'q3',
      kind: 'write-query',
      prompt:
        'Prove the M:N relationship resolves correctly. For every order, list the order id and the ' +
        'names of the products it contains, one row per order/product pair. Return `order_id` and ' +
        '`product_name`. Values and column names matter; row order does not.',
      referenceSql: `SELECT oi.order_id AS order_id, p.name AS product_name FROM order_items oi JOIN products p ON p.id = oi.product_id`,
      themes: ['set-based-thinking'],
      verify: [
        { sql: `SELECT count(*)::text FROM order_items`, equals: '10' },
        {
          sql: `SELECT count(*)::text FROM order_items oi JOIN products p ON p.id = oi.product_id`,
          equals: '10',
        },
      ],
      reveal: {
        correct:
          'SELECT oi.order_id, p.name AS product_name FROM order_items oi JOIN products p ON p.id = oi.product_id;',
        why:
          'You resolve an M:N by joining *through* the junction table — one hop to `order_items`, ' +
          'one hop out to `products`. The result has exactly 10 rows, one per junction row, ' +
          'because each `order_items` row references exactly one product (that side is many-to-' +
          'one, so it cannot fan out). This is the payoff of the join table: the pairing is ' +
          'queryable, each pair can carry its own quantity and price, and a foreign key guarantees ' +
          'both ends point at rows that actually exist.',
        reproduceSql:
          `SELECT oi.order_id, p.name AS product_name, oi.quantity, oi.unit_price\n` +
          `FROM order_items oi\n` +
          `JOIN products p ON p.id = oi.product_id\n` +
          `ORDER BY oi.order_id, p.name;`,
      },
    },
    {
      id: 'q4',
      kind: 'multiple-choice',
      prompt:
        '`inventory` holds exactly one row per product (10 products, 10 inventory rows), and its ' +
        '`product_id` column is both the primary key and a foreign key to `products`. Which part ' +
        'of that design actually **enforces** the one-to-one shape?',
      choices: [
        '`product_id` being the PRIMARY KEY — it makes duplicate product_id values impossible, capping it at one row per product.',
        'The foreign key to `products` — a foreign key permits at most one referencing row.',
        'The fact that both tables currently hold 10 rows — equal counts guarantee the 1:1.',
        'Nothing enforces it; 1:1 is a convention that only application code can maintain.',
      ],
      answerIndex: 0,
      themes: ['set-based-thinking'],
      verify: [
        { sql: `SELECT count(*)::text FROM inventory`, equals: '10' },
        {
          sql: `SELECT (count(*) = (SELECT count(*) FROM products))::text FROM inventory`,
          equals: 'true',
        },
        {
          sql: `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = 'inventory'::regclass AND i.indisprimary`,
          equals: 'product_id',
        },
      ],
      reveal: {
        correct:
          'The PRIMARY KEY on `product_id`. Primary keys are unique, so a second inventory row for ' +
          'the same product is rejected by the database.',
        why:
          'The two constraints do different jobs, and only together do they make the shape real. ' +
          'The foreign key guarantees every inventory row points at a product that exists — it ' +
          'says nothing about *how many* rows may point at the same one. Uniqueness is what caps ' +
          'it at one, and here that comes free because `product_id` is the primary key rather than ' +
          'a surrogate `id`. Reusing the FK column as the PK is the standard way to express 1:1, ' +
          'and it is worth noticing what it still does not enforce: a product with *no* inventory ' +
          'row is entirely legal, so this is strictly "zero or one", not "exactly one". Try it ' +
          'yourself — `INSERT INTO inventory (product_id, stock, reorder_level, updated_at) ' +
          'VALUES (1, 999, 10, now());` is rejected with SQLSTATE 23505 (unique_violation), ' +
          'because product 1 already has a row.',
        distractors: [
          'A foreign key constrains the referencing value to exist; it places no limit on how many rows reference the same parent. Without the PK, ten inventory rows could point at one product.',
          'Equal row counts are a property of today\'s data, not a constraint. Nothing would stop an eleventh inventory row being inserted tomorrow.',
          'The database enforces it precisely — that is the whole argument for pushing promises into the schema rather than trusting every future caller to remember them.',
        ],
        reproduceSql:
          `-- product_id is the primary key, so every product has at most one inventory row.\n` +
          `-- No product appears twice — which is the 1:1 shape, enforced rather than hoped for.\n` +
          `SELECT p.id, p.name, count(i.product_id) AS inventory_rows, max(i.stock) AS stock\n` +
          `FROM products p\n` +
          `LEFT JOIN inventory i ON i.product_id = p.id\n` +
          `GROUP BY p.id, p.name\n` +
          `ORDER BY p.id;`,
      },
    },
  ],
};
