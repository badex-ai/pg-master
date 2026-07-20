/**
 * Design · Unit design.2 — Find the entities (nouns) and their relationships.
 *
 * DESIGN.md §2. Nouns with identity and a lifecycle become tables; nouns that merely describe
 * another noun become columns. Verbs become relationships. Like design.1 this is judgment work
 * with no schema to grade against, so the questions are multiple-choice / explain-mechanism — but
 * every claim is made about the seeded schema and pinned with verify[], so the learner can run
 * the query that settles it. The three tests (own identity? many per parent? own attributes?) are
 * checked against real tables: `payments` is an entity, a product's `sku` is an attribute.
 */

import type { Lesson } from '@/lib/content/types';

export const designEntities: Lesson = {
  id: 'design.entities',
  unit: 'design.2',
  tier: 'design',
  title: 'Find the entities and their relationships',
  teach: `## Nouns become tables, or columns — never both

From the access patterns and a plain-English description of the product, pull out the **nouns**.
Then sort them.

Nouns with **identity and a lifecycle** become **entities** (tables): *user, order, payment,
shipment*. Nouns that merely **describe** another noun become **attributes** (columns): a user's
*email*, a product's *sku*.

**Three tests to tell them apart:**

1. **Does it have its own identity that something else refers to?** A \`payment\` is referred to
   by refunds and reconciliation → entity. A \`sku\` is referred to by nothing → attribute.
2. **Are there *many* of them per parent?** One order has many shipments → \`shipments\` is its own
   table with an \`order_id\`, not a \`shipment_1\`/\`shipment_2\` pair of columns.
3. **Does it have its own attributes?** A payment has an amount, a method, a status, and a
   timestamp → entity. If a noun is starting to grow its own fields, it has stopped being an
   attribute.

**Verbs become relationships.** "A user *places* an order." "An order *contains* products." "A
payment *settles* an order." Each verb is an edge between two entities, and each edge becomes
either a foreign key or a join table — that is unit design.3.

**Why this works:** it is a mechanical translation from how humans describe the domain into how a
relational database represents it. The domain expert's sentences already contain the schema. You
are transcribing, not inventing.

**The failure mode to recognise.** When a noun that deserved to be an entity is crushed into a
column, you get columns like \`shipment_1_carrier\`, \`shipment_2_carrier\` — un-queryable,
un-constrainable, and capped at whatever number you guessed. The moment you need a third, you
need a migration. Every one of those columns is a table that was denied.`,
  exampleSql: `-- Each of these is a separate entity because it has identity, cardinality,
-- and attributes of its own. Count them per order and the "many" side is obvious.
SELECT o.id AS order_id,
       count(DISTINCT oi.id) AS line_items,
       count(DISTINCT s.id)  AS shipments,
       count(DISTINCT p.id)  AS payments
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
LEFT JOIN shipments   s  ON s.order_id  = o.id
LEFT JOIN payments    p  ON p.order_id  = o.id
GROUP BY o.id
ORDER BY o.id;`,
  questions: [
    {
      id: 'q1',
      kind: 'multiple-choice',
      prompt:
        'A product has a `sku` (a unique code like `LAP-001`) and a set of `reviews`. One of these ' +
        'is modelled as a column on `products` and the other as its own table. Which test most ' +
        'directly decides that `sku` is an attribute but `review` is an entity?',
      choices: [
        'There are many reviews per product, and a review has its own attributes; a product has exactly one sku, which has none of its own.',
        '`sku` is text and `reviews` contain text plus numbers, and mixed types require a separate table.',
        '`sku` is unique and uniqueness can only be enforced on a column, never across a table.',
        '`reviews` are written after the product exists, and anything written later belongs in its own table.',
      ],
      answerIndex: 0,
      themes: ['set-based-thinking'],
      verify: [
        { sql: `SELECT count(*)::text FROM reviews`, equals: '10' },
        {
          sql: `SELECT count(*)::text FROM (SELECT product_id FROM reviews GROUP BY 1 HAVING count(*) > 1) t`,
          equals: '2',
        },
        {
          sql: `SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'reviews'`,
          equals: 'id,product_id,user_id,rating,body,created_at',
        },
      ],
      reveal: {
        correct:
          'Cardinality and own-attributes: many reviews per product, and a review carries a ' +
          'rating, a body, an author and a timestamp of its own. A product has one sku, and the ' +
          'sku has no attributes of its own.',
        why:
          'The two decisive tests are "how many per parent?" and "does it have its own fields?". ' +
          'A review answers *many* and *yes*, so it needs its own row with its own primary key — ' +
          'two products in this seed already carry more than one review, which a column could ' +
          'not hold. The sku answers *one* and *no*: it is a bare value describing the product, ' +
          'with nothing hanging off it, so it is a column. Note that a review also passes the ' +
          'identity test, since likes or replies could refer to a specific review.',
        distractors: [
          'Data type is irrelevant to the entity/attribute decision. A table can mix types freely in one row; that is what a row is.',
          'Backwards — uniqueness is routinely enforced across a table. `reviews` itself has a UNIQUE (product_id, user_id) constraint spanning two columns of every row.',
          'Write ordering does not decide structure. A product\'s `created_at` is also written at a point in time and is still just a column.',
        ],
        reproduceSql:
          `-- Products carrying more than one review: a column could never hold these.\n` +
          `SELECT product_id, count(*) AS review_count\n` +
          `FROM reviews\n` +
          `GROUP BY product_id\n` +
          `HAVING count(*) > 1\n` +
          `ORDER BY product_id;`,
      },
    },
    {
      id: 'q2',
      kind: 'multiple-choice',
      prompt:
        'A teammate proposes dropping the `shipments` table and instead adding ' +
        '`shipment_carrier`, `shipment_tracking_no` and `shipment_shipped_at` columns directly to ' +
        '`orders`. Looking at the seeded data, what is the **first** thing that breaks?',
      choices: [
        'Order 101 has three shipments, so two of them have nowhere to go.',
        'Nothing breaks; it is a valid denormalization that removes a join.',
        'The `orders` table would exceed the maximum column count for a Postgres table.',
        'Foreign keys stop working because `orders` would reference itself.',
      ],
      answerIndex: 0,
      themes: ['set-based-thinking', 'cost-of-writes'],
      verify: [
        { sql: `SELECT count(*)::text FROM shipments WHERE order_id = 101`, equals: '3' },
        {
          sql: `SELECT max(c)::text FROM (SELECT count(*) AS c FROM shipments GROUP BY order_id) t`,
          equals: '3',
        },
      ],
      reveal: {
        correct: 'Order 101 has three shipments; a single set of columns can hold only one.',
        why:
          'This is the cardinality test failing in production. A split delivery — some items ship ' +
          'today, the rest next week — is a normal business event, and the "many" side of a 1:N ' +
          'relationship cannot be flattened into a fixed set of columns on the "one" side. You ' +
          'could add `shipment_2_*` and `shipment_3_*`, but you have then hard-coded a limit the ' +
          'business never agreed to, and every query asking "which orders shipped via DHL" must ' +
          'now check three column sets instead of one indexed predicate.',
        distractors: [
          'It is not a denormalization, it is data loss: two of order 101\'s three shipments have no representation at all.',
          'Postgres allows up to 1600 columns per table; three more is nowhere near any limit. The problem is semantic, not a resource cap.',
          'Nothing would make orders self-referencing. The FK would simply cease to exist, taking its referential guarantee with it.',
        ],
        reproduceSql:
          `-- Every shipment for order 101 — three rows that three columns could not hold.\n` +
          `SELECT id, order_id, carrier, tracking_no, shipped_at\n` +
          `FROM shipments\n` +
          `WHERE order_id = 101\n` +
          `ORDER BY id;`,
      },
    },
    {
      id: 'q3',
      kind: 'explain-mechanism',
      prompt:
        'The sentence "a **user** *places* an **order**, which *contains* **products** and is ' +
        '*settled by* a **payment**" describes four nouns and three verbs. Explain how this ' +
        'single sentence maps onto the tables and foreign keys in this database — and why one of ' +
        'those three verbs needs a table of its own rather than a foreign key.',
      themes: ['set-based-thinking'],
      verify: [
        { sql: `SELECT count(*)::text FROM order_items`, equals: '10' },
        {
          sql: `SELECT count(*)::text FROM (SELECT product_id FROM order_items GROUP BY 1 HAVING count(DISTINCT order_id) > 1) t`,
          equals: '2',
        },
        {
          sql: `SELECT count(*)::text FROM (SELECT order_id FROM order_items GROUP BY 1 HAVING count(DISTINCT product_id) > 1) t`,
          equals: '3',
        },
      ],
      reveal: {
        correct:
          'The four nouns become `users`, `orders`, `products`, `payments`. "Places" becomes ' +
          '`orders.user_id`; "settled by" becomes `payments.order_id`; but "contains" cannot be a ' +
          'foreign key — it becomes the `order_items` table.',
        why:
          'Each verb is an edge, and the edge\'s *shape* decides its implementation. "Places" and ' +
          '"settled by" both point from a many side to a single parent, so a foreign key column ' +
          'suffices. "Contains" is different: an order holds many products **and** a product ' +
          'appears in many orders. In this seed three orders contain more than one product, and ' +
          'two products appear in more than one order — so neither side can hold a single ' +
          'reference to the other, and a column holds exactly one value. The relationship itself ' +
          'must become a row, which is what `order_items` is. That it also carries `quantity` and ' +
          '`unit_price` is the confirmation: the relationship had attributes of its own, so it ' +
          'was always an entity in disguise.',
        reproduceSql:
          `-- "Contains" runs both ways: many products per order, many orders per product.\n` +
          `SELECT order_id, count(DISTINCT product_id) AS products_in_order\n` +
          `FROM order_items GROUP BY order_id HAVING count(DISTINCT product_id) > 1\n` +
          `ORDER BY order_id;\n` +
          `\n` +
          `SELECT product_id, count(DISTINCT order_id) AS orders_containing_it\n` +
          `FROM order_items GROUP BY product_id HAVING count(DISTINCT order_id) > 1\n` +
          `ORDER BY product_id;`,
      },
    },
  ],
};
