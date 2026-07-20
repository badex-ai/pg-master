/**
 * Design · Unit design.1 — Start with the questions, not the tables.
 *
 * DESIGN.md §1. The access patterns are the spec; the schema is the implementation. This unit is
 * judgment-first (there is no schema yet when you do this work), so its questions are
 * multiple-choice / explain-mechanism rather than write-query. What keeps it honest — and keeps
 * the Run button live — is that every claim it makes about a schema is a claim about the *seeded
 * e-commerce database*, pinned with verify[] and reproducible in the editor. The learner reads a
 * design decision, then runs the query that decision was made to serve.
 */

import type { Lesson } from '@/lib/content/types';

export const designAccessPatterns: Lesson = {
  id: 'design.access-patterns',
  unit: 'design.1',
  tier: 'design',
  title: 'Start with the questions, not the tables',
  teach: `## The access patterns are the spec

The mistake is opening a blank file and typing \`CREATE TABLE users\`. That is designing
storage before you know what the storage is *for*.

Write down the **questions the application will ask** first:

- **Reads** — "show a user's orders", "count a product's reviews", "list what shipped late".
  Each read tells you what must be *fast* and what you will *join*.
- **Writes** — "place an order", "record a payment". Each write tells you what must be
  *consistent* and where contention will happen.
- **Volume and shape** — ten thousand orders and ten billion orders are *different design
  problems* for the same entity.

**Why this must come first.** Indexes, denormalization, and partitioning are all answers to
*specific* access patterns. You cannot choose them correctly without the list — you would be
guessing which queries matter. The dominant query earns the right to distort the schema in its
favour; every other query lives with the consequences.

**A schema is a set of promises about your data**, enforced by the database instead of by hope.
Every type, every \`NOT NULL\`, every foreign key is you deciding what must always be true and
making the database refuse anything else. Push those promises up into application code and every
developer must remember them forever — and one won't.

**Read the schema you already have as a record of decisions.** The database in this app was
designed around a handful of reads: show an order with its buyer, show an order's line items,
show a product's reviews. Each of those reads is why a particular foreign key exists. Nothing in
a good schema is decorative.`,
  exampleSql: `-- The access pattern "show me an order with its buyer and its line items"
-- is the reason orders.user_id and order_items.order_id exist at all.
SELECT o.id AS order_id, u.full_name, oi.product_id, oi.quantity
FROM orders o
LEFT JOIN users u ON u.id = o.user_id
JOIN order_items oi ON oi.order_id = o.id
ORDER BY o.id, oi.product_id;`,
  questions: [
    {
      id: 'q1',
      kind: 'multiple-choice',
      prompt:
        'You are designing the orders system and have not written any DDL yet. Which of these ' +
        'should you write down **first**?',
      choices: [
        'The list of reads and writes the application will perform, with expected volumes.',
        'The `CREATE TABLE` statements for every noun in the product brief.',
        'The indexes, so queries are fast from day one.',
        'The ORM model classes, so the application layer can start immediately.',
      ],
      answerIndex: 0,
      themes: ['set-based-thinking'],
      reveal: {
        correct: 'The list of reads and writes, with expected volumes.',
        why:
          'Every later decision is downstream of this list. An index exists to serve a specific ' +
          'read; a denormalization exists to avoid a specific join; a partition key exists ' +
          'because a specific query filters on it. Without the access patterns you are not ' +
          'making those decisions, you are guessing at them — and a guess that turns out wrong ' +
          'costs a migration under load rather than an edit to a text file.',
        distractors: [
          'CREATE TABLE first is exactly the mistake: it commits to a storage shape before you know what reads it must serve.',
          'Indexes are answers to access patterns. Writing them first means inventing the questions to fit the answers, and you will index columns nobody filters on while missing the ones they do.',
          'ORM models encode the same premature commitment as raw DDL, with an extra layer of indirection hiding it.',
        ],
      },
    },
    {
      id: 'q2',
      kind: 'multiple-choice',
      prompt:
        'In this database, `orders.user_id` is a nullable foreign key to `users`. Four of the ten ' +
        'users have never placed an order, and one order has no user at all (a guest checkout). ' +
        'Which access pattern best explains why `user_id` was made **nullable** rather than ' +
        '`NOT NULL`?',
      choices: [
        '"Accept an order from someone who is not a registered user" — guest checkout is a supported write.',
        '"Show all users, including those with no orders" — the read needs users without orders.',
        '"Count how many orders exist" — a nullable column makes counting faster.',
        '"Delete a user without deleting their orders" — nullable columns cascade automatically.',
      ],
      answerIndex: 0,
      themes: ['null-correctness'],
      verify: [
        { sql: `SELECT count(*)::text FROM orders WHERE user_id IS NULL`, equals: '1' },
        {
          sql: `SELECT count(*)::text FROM users u WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)`,
          equals: '4',
        },
        { sql: `SELECT count(*)::text FROM users`, equals: '10' },
      ],
      reveal: {
        correct:
          'Guest checkout: the business supports a write that creates an order with no user, so ' +
          'the column must permit NULL.',
        why:
          'Nullability is decided by the *writes*, not the reads. `NOT NULL` is a promise that ' +
          'the column always has a value; the moment the business says "a guest can buy without ' +
          'an account", that promise becomes false and the constraint would reject a legitimate ' +
          'order. Note this is a real cost, not a free choice — every read joining orders to ' +
          'users must now use a LEFT JOIN or silently drop the guest order.',
        distractors: [
          'Users without orders are unaffected by orders.user_id nullability — they simply have no matching row. That is a property of the join, not the constraint.',
          'Counting is unrelated to nullability, and NULLs generally make aggregate reasoning harder, not faster.',
          'Nullable does not imply any delete behaviour. Cascading is ON DELETE SET NULL / CASCADE — an explicit choice on the foreign key, entirely separate from whether the column accepts NULL.',
        ],
        reproduceSql:
          `-- The guest order, and the users who have never ordered.\n` +
          `SELECT id AS order_id, user_id, status, total FROM orders WHERE user_id IS NULL;\n` +
          `\n` +
          `SELECT u.id, u.email\n` +
          `FROM users u\n` +
          `WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)\n` +
          `ORDER BY u.id;`,
      },
    },
    {
      id: 'q3',
      kind: 'explain-mechanism',
      prompt:
        '`order_items` stores a `unit_price` even though `products` already has a `price` column. ' +
        'Product 6 currently costs 59.50, but an `order_items` row records it as sold for 59.00. ' +
        'Which access pattern forced that apparently duplicated column — and what breaks if you ' +
        'remove it and join to `products.price` instead?',
      themes: ['set-based-thinking'],
      verify: [
        {
          sql: `SELECT count(*)::text FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.unit_price <> p.price`,
          equals: '2',
        },
        { sql: `SELECT price::text FROM products WHERE id = 6`, equals: '59.50' },
      ],
      reveal: {
        correct:
          'The read "show me what this order actually cost" requires the price *at the time of ' +
          'purchase*. Removing `unit_price` and joining to `products.price` makes every historical ' +
          'order silently rewrite itself whenever a price changes.',
        why:
          '`products.price` is *current* state; `order_items.unit_price` is a *historical fact*. ' +
          'They answer different questions and therefore cannot be the same column, however ' +
          'redundant they look. This is the case where duplication is correct: the value is not a ' +
          'cached copy of the product price, it is an independent record of what was agreed at ' +
          'checkout. Drop it and a routine price update retroactively falsifies every past ' +
          'invoice, receipt, and revenue report — a data-loss bug with no error message, which is ' +
          'the worst kind. Two rows in this seed already diverge — product 6 was sold at 59.00 in ' +
          'one order and 29.50 in another, and now lists at 59.50 — which is enough to prove the ' +
          'two columns are not interchangeable.',
        reproduceSql:
          `-- Where the historical price and the current price disagree.\n` +
          `SELECT oi.order_id, oi.product_id, p.name,\n` +
          `       oi.unit_price AS paid, p.price AS current_price\n` +
          `FROM order_items oi\n` +
          `JOIN products p ON p.id = oi.product_id\n` +
          `WHERE oi.unit_price <> p.price;`,
      },
    },
  ],
};
