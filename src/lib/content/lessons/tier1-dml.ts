/**
 * Tier 1 · Unit 1.7 — Basic data modification (INSERT / UPDATE / DELETE).
 *
 * The first unit whose subject is mutation rather than reading, so it is also the first to use
 * probe-graded `write-query` questions: a mutation has no result set worth comparing, so the
 * grader runs the reference mutation, observes the state it produced, reseeds, runs the learner's
 * mutation and compares the same observations (see StateProbe in content/types.ts).
 *
 * Dataset centrepieces: orders 104/108 are 'paid' (the UPDATE targets), order 101 is referenced by
 * order_items so a bare DELETE is FK-blocked, users 4/9 are 'inactive' vs user 6 already 'banned'
 * (the "wrong rows unchanged" probe), and every id column is GENERATED ALWAYS AS IDENTITY, so an
 * INSERT supplying its own id is an error rather than an override. Runs against the base seed.
 */

import type { Lesson } from '@/lib/content/types';

export const tier1Dml: Lesson = {
  id: 'tier1.dml',
  unit: '1.7',
  tier: 1,
  title: 'Basic data modification (DML)',
  teach: `## Changing the data

Three statements change rows, and all three are set-based — they act on however many rows the
predicate selects, not on one row at a time.

- **INSERT INTO … VALUES (…)** — add rows. Columns you omit take their DEFAULT (or NULL).
- **UPDATE … SET … WHERE …** — change columns in the rows matching the predicate.
- **DELETE FROM … WHERE …** — remove the rows matching the predicate.

**The WHERE clause is the whole safety story.** \`UPDATE\` and \`DELETE\` treat a missing
\`WHERE\` as "every row" — it is not a syntax error, and there is no confirmation prompt. Write
the \`WHERE\` first, and before running anything destructive, run the same predicate as a
\`SELECT\` to see exactly which rows you are about to hit.

**RETURNING gives the statement a result set.** Postgres lets any of the three end with
\`RETURNING\`, which emits the rows as they were actually written — including
database-generated values you could not know in advance, like an identity id or a DEFAULT
timestamp. \`INSERT … RETURNING id\` is how you learn the new row's key without a second query
and without a race.

**The database pushes back.** A write only succeeds if it leaves every constraint satisfied:
a \`NOT NULL\` column needs a value, a \`CHECK\` limits what that value may be, \`UNIQUE\`
rejects a duplicate, and a \`FOREIGN KEY\` refuses to delete a row that something else still
references. These rejections are a feature — the schema is enforcing an invariant your
application code would otherwise have to remember every single time.

**Identity columns are not yours to set.** These tables declare ids as
\`GENERATED ALWAYS AS IDENTITY\`, so an INSERT that supplies its own id is rejected outright
rather than quietly accepted. Omit the column and let the sequence assign it.`,
  exampleSql: `UPDATE orders
SET status = 'cancelled'
WHERE status = 'paid'
RETURNING id, status;`,
  questions: [
    {
      id: 'q1',
      kind: 'predict-output',
      prompt:
        'Orders 104 and 108 are the only ones with status `paid`. Predict exactly what this ' +
        'returns (the statement is a single UPDATE, and RETURNING reports the rows it wrote):\n\n' +
        '```sql\nUPDATE orders\nSET status = \'cancelled\'\nWHERE status = \'paid\'\n' +
        'RETURNING id, status;\n```',
      sql: `UPDATE orders SET status = 'cancelled' WHERE status = 'paid' RETURNING id, status`,
      expected: { columns: ['id', 'status'], rows: [[104, 'cancelled'], [108, 'cancelled']] },
      themes: ['cost-of-writes', 'set-based-thinking'],
      verify: [
        {
          sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM orders WHERE status = 'paid'`,
          equals: '104,108',
        },
        {
          sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM orders WHERE status = 'cancelled'`,
          equals: '106',
        },
      ],
      reveal: {
        correct: 'Two rows: (104, cancelled) and (108, cancelled).',
        why:
          'The UPDATE is set-based: the predicate matches both paid orders and both are rewritten ' +
          'in one statement. RETURNING reports each row in its *post-update* state, which is why ' +
          'status reads `cancelled` and not the `paid` it held a moment earlier. Order 106 was ' +
          'already cancelled before the statement ran, so it never matched the WHERE and is absent ' +
          'from the output — RETURNING only emits rows the statement actually touched.',
        reproduceSql:
          `UPDATE orders\nSET status = 'cancelled'\nWHERE status = 'paid'\nRETURNING id, status;`,
      },
    },
    {
      id: 'q2',
      kind: 'predict-error',
      prompt:
        'Order 101 exists. Does this run?\n\n```sql\nDELETE FROM orders WHERE id = 101;\n```',
      sql: `DELETE FROM orders WHERE id = 101`,
      runs: false,
      sqlState: '23503',
      themes: ['cost-of-writes'],
      verify: [
        { sql: `SELECT count(*)::text FROM order_items WHERE order_id = 101`, equals: '2' },
        { sql: `SELECT count(*)::text FROM orders WHERE id = 101`, equals: '1' },
      ],
      reveal: {
        correct:
          'No — it raises a foreign-key violation (SQLSTATE 23503), on ' +
          '`order_items_order_id_fkey`.',
        why:
          'Two rows in order_items reference order 101. The FK on order_items.order_id defaults to ' +
          'NO ACTION, so Postgres refuses to delete a parent row that still has children rather ' +
          'than leaving those children pointing at an order that no longer exists. The fix depends ' +
          'on intent: delete the children first, or declare the constraint ON DELETE CASCADE if ' +
          'child rows are genuinely meaningless without the parent. Note the error names the *child* ' +
          'table — the constraint lives on order_items, not on orders.',
        reproduceSql: `DELETE FROM order_items WHERE order_id = 101;\nDELETE FROM orders WHERE id = 101;`,
      },
    },
    {
      id: 'q3',
      kind: 'predict-error',
      prompt:
        'Every id in this schema is declared `GENERATED ALWAYS AS IDENTITY`. Does this run?\n\n' +
        '```sql\nINSERT INTO categories (id, name, slug)\nVALUES (11, \'Monitors\', \'monitors\');\n```',
      sql: `INSERT INTO categories (id, name, slug) VALUES (11, 'Monitors', 'monitors')`,
      runs: false,
      sqlState: '428C9',
      themes: ['cost-of-writes'],
      verify: [
        { sql: `SELECT count(*)::text FROM categories`, equals: '10' },
        {
          sql: `SELECT is_identity FROM information_schema.columns WHERE table_name = 'categories' AND column_name = 'id'`,
          equals: 'YES',
        },
      ],
      reveal: {
        correct:
          'No — `cannot insert a non-DEFAULT value into column "id"` (SQLSTATE 428C9).',
        why:
          'GENERATED ALWAYS means the database owns the value: it refuses a caller-supplied id ' +
          'rather than accepting it and leaving the underlying sequence behind the data, which is ' +
          'how you get a duplicate-key error on some later insert that had nothing to do with the ' +
          'bug. Omit the column entirely and the sequence assigns 11. GENERATED BY DEFAULT AS ' +
          'IDENTITY would have allowed the override — and inherited exactly that lagging-sequence ' +
          'problem. (The seed itself gets around this with OVERRIDING SYSTEM VALUE, deliberately, ' +
          'because the curated ids are meaningful; it then fixes the sequences up by hand.)',
        reproduceSql: `INSERT INTO categories (name, parent_id, slug)\nVALUES ('Monitors', 5, 'monitors')\nRETURNING id, name, slug;`,
      },
    },
    {
      id: 'q4',
      kind: 'multiple-choice',
      prompt:
        'You mean to cancel the two `paid` orders, but run this instead:\n\n' +
        '```sql\nUPDATE orders SET status = \'cancelled\';\n```\n\n' +
        'What happens?',
      choices: [
        'All 10 orders become cancelled — a missing WHERE means every row.',
        'Nothing — an UPDATE without WHERE is rejected as unsafe.',
        'Only the 2 paid orders change; Postgres infers the intended predicate from the SET clause.',
        'It raises a syntax error: UPDATE requires a WHERE clause.',
      ],
      answerIndex: 0,
      themes: ['cost-of-writes'],
      verify: [
        { sql: `SELECT count(*)::text FROM orders`, equals: '10' },
        {
          sql: `SELECT count(*)::text FROM orders WHERE status = 'cancelled'`,
          equals: '1',
        },
      ],
      reveal: {
        correct: 'All 10 orders are cancelled.',
        why:
          'WHERE is optional in both UPDATE and DELETE, and its absence means "every row" — this is ' +
          'valid SQL that does exactly what it says. There is no confirmation step and no undo ' +
          'once the transaction commits; the nine orders that should not have changed are simply ' +
          'gone, with no record of what they used to be. The habits that prevent it: run the ' +
          'predicate as a SELECT first, and wrap risky writes in an explicit BEGIN so an unexpected ' +
          'row count can still be rolled back.',
        distractors: [
          'Postgres has no such safety net (some clients bolt one on, but the server does not).',
          'The SET clause is not a predicate — it says what to write, never which rows to write it to.',
          'The grammar makes WHERE optional; omitting it is legal, which is precisely why this is dangerous.',
        ],
        reproduceSql: `SELECT count(*) FROM orders WHERE status = 'paid';`,
      },
    },
    {
      id: 'q5',
      kind: 'write-query',
      prompt:
        'Users 4 and 9 are `inactive`. Ban them: set their `status` to `banned`, and leave every ' +
        'other user exactly as they are. (User 6 is already banned — your statement must not ' +
        'depend on that, or rewrite it.)',
      referenceSql: `UPDATE users SET status = 'banned' WHERE status = 'inactive'`,
      probes: [
        {
          label: 'the newly banned users',
          sql: `SELECT id, status FROM users WHERE id IN (4, 9) ORDER BY id`,
        },
        {
          label: 'every other user',
          sql: `SELECT id, status FROM users WHERE id NOT IN (4, 9) ORDER BY id`,
        },
      ],
      themes: ['cost-of-writes', 'set-based-thinking'],
      verify: [
        {
          sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM users WHERE status = 'inactive'`,
          equals: '4,9',
        },
        {
          sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM users WHERE status = 'banned'`,
          equals: '6',
        },
        // The over-broad predicate discussed in the reveal writes 3 rows where the reference writes
        // 2, yet lands on identical state — pinning both counts keeps that claim honest.
        {
          sql: `SELECT count(*)::text FROM users WHERE status = 'inactive'`,
          equals: '2',
        },
        {
          sql: `SELECT count(*)::text FROM users WHERE status <> 'active'`,
          equals: '3',
        },
        { sql: `SELECT count(*)::text FROM users`, equals: '10' },
      ],
      reveal: {
        correct: `UPDATE users SET status = 'banned' WHERE status = 'inactive';`,
        why:
          'One predicate matches both inactive users (4 and 9) and rewrites them in a single ' +
          'set-based statement — no loop, no per-row round trip. Your answer is judged on the state ' +
          'it leaves behind, checked in two parts: that users 4 and 9 ended up banned, and that ' +
          'everyone else is untouched. Worth knowing what that does *not* catch: ' +
          '`WHERE status <> \'active\'` also grades correct here. It writes three rows rather than ' +
          'two — user 6 is swept in as well — but user 6 was already banned, so the database ends ' +
          'up byte-identical and no state check can tell the two apart. The wasted write is real ' +
          '(it burns a row version, fires any trigger, and takes a lock) and only shows up in the ' +
          'statement\'s reported row count, which is exactly why `UPDATE ... RETURNING` and the ' +
          'affected-row count are worth reading rather than ignoring.',
        reproduceSql:
          `UPDATE users SET status = 'banned' WHERE status <> 'active' RETURNING id, status;`,
      },
    },
    {
      id: 'q6',
      kind: 'write-query',
      prompt:
        'Add a new category named `Monitors` with slug `monitors`, nested under the existing ' +
        '`Peripherals` category (id 5). Let the database assign the id.',
      referenceSql: `INSERT INTO categories (name, parent_id, slug) VALUES ('Monitors', 5, 'monitors')`,
      probes: [
        {
          label: 'the new category',
          sql: `SELECT name, parent_id, slug FROM categories WHERE slug = 'monitors'`,
        },
        { label: 'the category count', sql: `SELECT count(*)::text AS c FROM categories` },
      ],
      themes: ['cost-of-writes'],
      verify: [
        { sql: `SELECT count(*)::text FROM categories`, equals: '10' },
        { sql: `SELECT name FROM categories WHERE id = 5`, equals: 'Peripherals' },
        { sql: `SELECT count(*)::text FROM categories WHERE slug = 'monitors'`, equals: '0' },
      ],
      reveal: {
        correct: `INSERT INTO categories (name, parent_id, slug) VALUES ('Monitors', 5, 'monitors');`,
        why:
          'Naming the columns explicitly and omitting `id` is what lets the identity column ' +
          'generate the key — supplying it would be rejected (see the identity question above). ' +
          'The `parent_id` of 5 is what makes this a *child* of Peripherals: categories is a ' +
          'self-referencing tree, so the parent link is just an FK back into the same table, and ' +
          'it must reference a row that already exists. Adding `RETURNING id` would tell you the ' +
          'generated key in the same round trip — the standard way to get it, since anything based ' +
          'on `max(id)` afterwards is a race between concurrent inserts.',
        reproduceSql:
          `INSERT INTO categories (name, parent_id, slug)\nVALUES ('Monitors', 5, 'monitors')\nRETURNING id, name, parent_id, slug;`,
      },
    },
  ],
};
