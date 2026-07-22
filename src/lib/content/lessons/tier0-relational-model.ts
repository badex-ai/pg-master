/**
 * Tier 0 · Unit 0.1 — What a relational database is.
 *
 * The foundation the rest of the track stands on: a table is a SET of typed rows, and the word
 * "relational" is about splitting facts across tables and re-linking them by keys — a foreign key
 * being a promise the engine enforces, not a convention. Teaches the two properties that fall out
 * of "set" (membership is by value, not by position or name; keys forbid duplicates) and grounds
 * the foreign-key promise on a real violation (23503) and the seed's one guest order (105, NULL
 * user_id). q2 is `predict-error` — the one kind allowed to reproduce a failure. Base seed, no
 * setupSql.
 */

import type { Lesson } from '@/lib/content/types';

export const tier0RelationalModel: Lesson = {
  id: 'tier0.relational-model',
  unit: '0.1',
  tier: 0,
  title: 'What a relational database is',
  teach: `## A table is a set of rows — and that one idea explains most of SQL

Before any query, get this straight: a **table is a set**. Not a list, not a spreadsheet, not a
file of lines in some order. A mathematical set of **rows**, where each row is one **fact** about
the world, and every column is a **typed attribute** of that fact.

Look at one row of \`users\`:

\`\`\`
id=1  email='ada@example.com'  full_name='Ada Lovelace'  country='UK'  status='active'  …
\`\`\`

That row asserts a single fact: *"there is a user, id 1, named Ada, in the UK, active."* The table
\`users\` is the **set of all such facts**. Reading a table as a set — rather than as rows in a file
— is the mental switch that makes the rest of SQL stop feeling arbitrary. Three things follow
directly from it, and each one is a rule you would otherwise have to memorize:

**1. A set has no order.** The elements of \`{ada, grace, linus}\` are not "in" any order — it is the
*same set* however you list them. So a table has no built-in row order, and a \`SELECT\` without
\`ORDER BY\` may return rows in any order at all. That is not Postgres being lazy; it is the model.
(Unit 0.3 makes this precise.)

**2. A set has no duplicates — that is what keys enforce.** You cannot have the same element twice
in a set. Real tables enforce this with a **key**: \`users.email\` is declared \`UNIQUE\`, so trying
to insert a second row with \`ada@example.com\` is rejected. The **primary key** (\`users.id\`) is the
one chosen to *identify* each row — the guaranteed-unique, never-NULL handle you use to point at
exactly one fact.

**3. Membership is by value, not by name or position.** A row belongs to a query's result because
of *what it contains*, never because of where it sits or what you called the query. Ask for "the
keyboards" by category id or by the category's name — same rows, because you described the same
set. The description is interchangeable; the set is the truth.

### The "relational" part: one fact, one place, re-linked by keys

Here is the move that makes it a *relational* database rather than one giant table. We do **not**
cram everything into one wide table. We split facts by what they are about — users in \`users\`,
orders in \`orders\`, the line items of an order in \`order_items\` — and then **re-link** them with
keys. An \`orders\` row stores a \`user_id\`; that \`user_id\` **references** \`users.id\`. That reference
is a **foreign key**.

A foreign key is not a comment or a naming convention. It is a **promise the database enforces**:
*"this \`user_id\` must match some real \`users.id\`."* Try to insert an \`order_items\` row pointing at
a product that does not exist, and Postgres refuses the write with a foreign-key violation. The
integrity of the links is guaranteed by the engine, not by hoping the application got it right.

One deliberate exception in our data teaches the flip side: order **105** has \`user_id = NULL\` — a
guest checkout with no account. A nullable foreign key means *"this link may be absent"*, and NULL
is how "absent" is spelled (you'll meet NULL's full logic in 0.4). The key still forbids a
*wrong* link; it just permits *no* link.

**Why split at all?** Because a fact stored once, in one place, cannot disagree with itself. Ada's
name lives in exactly one \`users\` row; her three orders just carry her \`id\`. Change her name once
and every order still points at the current truth. That single-source-of-truth discipline is what
the design track builds on — here we only need to see that *keys are the connective tissue* that
lets facts live apart yet be joined back together on demand.`,
  exampleSql: `-- One fact per table, re-linked by keys: an order, its buyer, and its line items.
SELECT o.id AS order_id, u.full_name AS buyer, p.name AS product, oi.quantity
FROM orders o
JOIN users u        ON u.id = o.user_id
JOIN order_items oi ON oi.order_id = o.id
JOIN products p     ON p.id = oi.product_id
WHERE o.id = 101
ORDER BY p.name;`,
  questions: [
    {
      id: 'q1',
      kind: 'predict-output',
      prompt:
        'A table is a set, so a row is in a result because of its *value*, not because of how you ' +
        'named the query. These two queries ask for "the keyboards" two different ways — one by ' +
        'category id, one by the category’s name. Predict how many product ids they share:\n\n' +
        '```sql\nSELECT count(*) AS shared FROM (\n' +
        '  SELECT id FROM products WHERE category_id = 6\n' +
        '  INTERSECT\n' +
        '  SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id\n' +
        '  WHERE c.name = \'Keyboards\'\n' +
        ') t;',
      sql: `SELECT count(*) AS shared FROM (SELECT id FROM products WHERE category_id = 6 INTERSECT SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id WHERE c.name = 'Keyboards') t`,
      expected: { columns: ['shared'], rows: [[2]] },
      themes: ['set-based-thinking'],
      // The point is the two descriptions pick the identical set {4,5}, so INTERSECT keeps both.
      // Pin: each description returns 4,5; their intersection has 2 rows; category 6 IS 'Keyboards'.
      verify: [
        { sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM products WHERE category_id = 6`, equals: '4,5' },
        {
          sql: `SELECT string_agg(p.id::text, ',' ORDER BY p.id) FROM products p JOIN categories c ON c.id = p.category_id WHERE c.name = 'Keyboards'`,
          equals: '4,5',
        },
        { sql: `SELECT name FROM categories WHERE id = 6`, equals: 'Keyboards' },
      ],
      reveal: {
        correct: '2 — both descriptions pick out the identical set of products, ids 4 and 5.',
        why:
          'Category 6 *is* the "Keyboards" category, so "products in category 6" and "products in ' +
          'the category named Keyboards" are two descriptions of one and the same set — the ' +
          'Mechanical Keyboard (id 4) and the Compact 60% Keyboard (id 5). INTERSECT keeps only ' +
          'rows present in both, and since both sides are the same two rows, all 2 survive. This ' +
          'is membership-by-value: a product is "a keyboard" because of the fact it stores, not ' +
          'because of which query phrasing found it. Change the wording, keep the meaning, and the ' +
          'set does not move.',
        reproduceSql:
          `SELECT id, name FROM products WHERE category_id = 6 ORDER BY id;\n` +
          `-- the same two rows, reached through the category name instead:\n` +
          `SELECT p.id, p.name FROM products p JOIN categories c ON c.id = p.category_id\n` +
          `WHERE c.name = 'Keyboards' ORDER BY p.id;`,
      },
    },
    {
      id: 'q2',
      kind: 'predict-error',
      prompt:
        'A foreign key is a promise the database enforces. This tries to add a line item to order ' +
        '101 for product 9999 — a product id that does not exist in `products`. Does it run, or ' +
        'does it fail?\n\n' +
        '```sql\nINSERT INTO order_items (order_id, product_id, quantity, unit_price)\n' +
        'VALUES (101, 9999, 1, 10.00);\n```',
      sql: `INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (101, 9999, 1, 10.00)`,
      runs: false,
      sqlState: '23503',
      themes: ['set-based-thinking'],
      // Pin that 9999 is genuinely not a product, and that every existing order_items row already
      // points at a real product (0 orphans) — the invariant the FK maintains.
      verify: [
        { sql: `SELECT count(*)::text FROM products WHERE id = 9999`, equals: '0' },
        {
          sql: `SELECT count(*)::text FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE p.id IS NULL`,
          equals: '0',
        },
      ],
      reveal: {
        correct: 'It fails: ERROR 23503 — insert violates the foreign-key constraint on order_items.product_id.',
        why:
          '`order_items.product_id` is declared `REFERENCES products (id)`, so the engine checks — ' +
          'on every insert and update — that the value points at a row that actually exists in ' +
          '`products`. There is no product 9999, so the reference would dangle, and Postgres ' +
          'refuses the write rather than let the database hold a link to nothing. This is why all ' +
          '10 existing order_items already point at real products: the constraint has never let a ' +
          'bad one in. The application does not have to police this; the schema does.',
        reproduceSql:
          `-- The referenced row must exist. Point at a real product (id 1) and it succeeds:\n` +
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price)\n` +
          `VALUES (101, 1, 1, 10.00);\n` +
          `-- (rolled back by the reseed before the next question)`,
      },
    },
    {
      id: 'q3',
      kind: 'multiple-choice',
      prompt:
        'The `orders.user_id` column is a foreign key referencing `users.id`. What does that ' +
        'foreign key actually guarantee about the data?',
      choices: [
        'Every user has placed at least one order.',
        'Every order’s user_id either matches a real users.id or is NULL — never a made-up id.',
        'Orders and users always have the same number of rows.',
        'user_id values are stored in the same order as the users table.',
      ],
      answerIndex: 1,
      themes: ['set-based-thinking'],
      // Pin the two facts the correct answer and the "guest" distractor rest on: exactly one order
      // has a NULL user_id (105), and no order references a non-existent user (0 orphans).
      verify: [
        { sql: `SELECT string_agg(id::text, ',') FROM orders WHERE user_id IS NULL`, equals: '105' },
        {
          sql: `SELECT count(*)::text FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.user_id IS NOT NULL AND u.id IS NULL`,
          equals: '0',
        },
      ],
      reveal: {
        correct:
          'It guarantees every order’s user_id is either a real users.id or NULL — the reference is ' +
          'valid or deliberately absent, never a fabricated id.',
        why:
          'A foreign key constrains *validity of the link*, nothing more. It says a non-NULL ' +
          '`user_id` must match some existing `users.id`, and it allows NULL (order 105, the guest ' +
          'checkout) to mean "no linked user". It says nothing about counts, about every user ' +
          'having orders, or about storage order — a set has no storage order to speak of. The one ' +
          'promise is integrity of the reference itself.',
        distractors: [
          'A foreign key never forces the *parent* side to be used — plenty of users have no orders; it only constrains the child’s reference.',
          'Row counts are unrelated: orders and users are independent sets linked by a key, not kept equal in size.',
          'Tables are sets and have no guaranteed row order, so "same order as the users table" is not a thing a key could promise.',
        ],
        reproduceSql:
          `-- The one order with no linked user (the guest checkout):\n` +
          `SELECT id, user_id, status FROM orders WHERE user_id IS NULL;\n` +
          `-- Every other order points at a real user — this returns zero rows:\n` +
          `SELECT o.id FROM orders o LEFT JOIN users u ON u.id = o.user_id\n` +
          `WHERE o.user_id IS NOT NULL AND u.id IS NULL;`,
      },
    },
    {
      id: 'q4',
      kind: 'write-query',
      prompt:
        'Find the "guest" orders: those placed with no linked user account. Return the order `id` ' +
        'and its `total` for every order whose `user_id` is absent. Order by `id`.',
      referenceSql: `SELECT id, total FROM orders WHERE user_id IS NULL ORDER BY id`,
      compare: { orderMatters: true },
      themes: ['set-based-thinking', 'null-correctness'],
      // Exactly one such order — 105, total 89.99. Pin the id set and that it's the guest row.
      verify: [
        { sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM orders WHERE user_id IS NULL`, equals: '105' },
        { sql: `SELECT total::text FROM orders WHERE id = 105`, equals: '89.99' },
        { sql: `SELECT count(*)::text FROM orders WHERE user_id IS NULL`, equals: '1' },
      ],
      reveal: {
        correct: `SELECT id, total FROM orders WHERE user_id IS NULL ORDER BY id;`,
        why:
          'A nullable foreign key lets the link be *absent*, and "absent" is spelled NULL — so the ' +
          'guest orders are exactly the rows where `user_id IS NULL`. Here that is the single ' +
          'order 105 (total 89.99), the guest checkout. Note you must write `IS NULL`, not ' +
          '`= NULL`: a foreign key being null is a property of the row, tested with the IS NULL ' +
          'predicate, not an equality comparison (0.4 is the whole story on why). The key forbade ' +
          'a *wrong* buyer for every other order; it permitted *no* buyer here.',
        reproduceSql:
          `SELECT id, total FROM orders WHERE user_id IS NULL ORDER BY id;`,
      },
    },
  ],
};
