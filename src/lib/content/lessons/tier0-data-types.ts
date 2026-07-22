/**
 * Tier 0 · Unit 0.5 — Data types overview.
 *
 * Closes the mental-model tier. The type of a column is not decoration: it decides what a value
 * *means*, which operations are legal, and which comparisons are exact. Taught through the four
 * type choices already living in our schema, each a real trap: numeric (exact money) vs binary
 * float (0.1+0.2 ≠ 0.3); citext (case-insensitive email) vs plain text; timestamptz (one instant,
 * rendered per zone); jsonb (semi-structured, missing key ⇒ NULL); and CHECK-constrained text as a
 * lightweight enum (a bad value is refused, 23514). q3 is `predict-error` — the one kind allowed
 * to reproduce a failure. Base seed, no setupSql.
 */

import type { Lesson } from '@/lib/content/types';

export const tier0DataTypes: Lesson = {
  id: 'tier0.data-types',
  unit: '0.5',
  tier: 0,
  title: 'Data types overview',
  teach: `## The type decides what a value means — not just how it's stored

Every column has a type, and it is tempting to treat that as a storage detail: "it's a number, it's
some text." It is much more than that. A column's type decides **what the value means, which
operations are legal on it, and — crucially — when two values count as equal.** Pick the wrong
type and correct-looking SQL quietly returns wrong answers. Our schema already makes four type
choices deliberately, and each one teaches a trap worth knowing before you write another query.

### numeric vs floating point — exactness is a type decision

There are two families of "numbers with decimals" and they are *not* interchangeable:

- \`float8\`/\`real\` are **binary** floating point. Fast, but they cannot represent most decimal
  fractions exactly — so \`0.1 + 0.2\` comes out as \`0.30000000000000004\`, and \`0.1 + 0.2 = 0.3\`
  is **false**. Fine for physics; a disaster for money.
- \`numeric\` (a.k.a. \`decimal\`) is **exact** decimal. \`0.1 + 0.2\` is exactly \`0.3\`, and the
  equality is true.

That is why every money column in this schema — \`products.price\`, \`orders.total\`, \`payments.amount\`
— is \`numeric(10, 2)\`, never a float. The \`(10, 2)\` is **precision 10, scale 2**: up to 10 total
digits, exactly 2 after the point. It rounds on store (\`1299.005\` becomes \`1299.01\`) and it
*refuses* a value too big to fit (anything ≥ 100 000 000) rather than silently mangling it. The
rule: **money and any value where exact decimal equality matters is \`numeric\`, never float.**

### text vs citext — the type decides what "equal" means

\`users.full_name\` is plain \`text\`: comparisons are **case-sensitive**, so \`'Ada Lovelace'\` and
\`'ADA LOVELACE'\` are different strings. But \`users.email\` is \`citext\` — case-insensitive text.
Against \`citext\`, \`'ADA@EXAMPLE.COM'\` and \`'ada@example.com'\` are **equal**, so a lookup matches
regardless of case *and* the \`UNIQUE\` constraint forbids a second row that differs only in case.
Same-looking strings, opposite behaviour — decided entirely by the column's type, not by your query.

### timestamptz — one instant, rendered per time zone

\`timestamptz\` ("timestamp with time zone") does **not** store a zone. It stores a single absolute
instant (internally, UTC) and *renders* it in whatever zone the session is set to. Ada's
\`created_at\` is the one instant written \`2022-01-05 09:12:00+00\`; ask for it in New York and the
same instant reads \`04:12\`. It is one moment shown two ways — not two different times. (Its
sibling \`timestamp\` *without* time zone stores wall-clock text with no instant attached; for
"when did this actually happen" you almost always want \`timestamptz\`.)

### jsonb — structure inside a column, with NULL for "absent"

\`users.preferences\` and \`products.attributes\` are \`jsonb\`: a whole JSON document per row, queryable
in place. \`preferences->>'theme'\` extracts the \`theme\` value as text. The key rule: asking for a
key that isn't there returns **NULL**, not an error — so a missing preference and a user whose
whole \`preferences\` is NULL both come back NULL, and you filter them with the NULL logic from 0.4.
\`jsonb\` buys flexibility for genuinely schemaless data; the cost is that the database can't
constrain what's inside it the way a real column can.

### CHECK-constrained text — a lightweight enum

\`orders.status\` is just \`text\`, but with \`CHECK (status IN ('pending','paid','shipped',
'delivered','cancelled'))\`. That turns an open text column into a closed set of five legal values:
insert any other string and the write is **refused**, not stored. \`reviews.rating\` does the same
with a range (\`CHECK (rating BETWEEN 1 AND 5)\`). This is types and constraints working together —
the type says "text", the constraint narrows it to exactly the values that make sense. Choosing the
right type, then tightening it with a constraint, is the whole subject of the design track; here you
only need to see that **the type-plus-constraint is what keeps a bad value out of the table in the
first place.**`,
  exampleSql: `-- Four types, four behaviours, in one look:
SELECT
  id,
  email,                          -- citext: case-insensitive
  created_at,                     -- timestamptz: one instant, rendered in the session zone
  preferences->>'theme' AS theme  -- jsonb: NULL when the key (or the whole doc) is absent
FROM users
WHERE email = 'ADA@EXAMPLE.COM';  -- matches id 1 despite the uppercase, because email is citext`,
  questions: [
    {
      id: 'q1',
      kind: 'predict-output',
      prompt:
        'Exactness is a property of the *type*. The same arithmetic, done as binary float versus ' +
        'as exact `numeric`, does not give the same answer to "does it equal 0.3?". Predict both ' +
        'booleans:\n\n' +
        '```sql\nSELECT (0.1::float8  + 0.2::float8  = 0.3::float8)  AS float_eq,\n' +
        '       (0.1::numeric + 0.2::numeric = 0.3::numeric) AS numeric_eq;\n```',
      sql: `SELECT (0.1::float8 + 0.2::float8 = 0.3::float8) AS float_eq, (0.1::numeric + 0.2::numeric = 0.3::numeric) AS numeric_eq`,
      expected: { columns: ['float_eq', 'numeric_eq'], rows: [[false, true]] },
      themes: ['set-based-thinking'],
      // Pin both booleans and the tell-tale float sum, plus that price really is numeric(10,2).
      verify: [
        { sql: `SELECT (0.1::float8 + 0.2::float8 = 0.3::float8)::text`, equals: 'false' },
        { sql: `SELECT (0.1::numeric + 0.2::numeric = 0.3::numeric)::text`, equals: 'true' },
        { sql: `SELECT (0.1::float8 + 0.2::float8)::text`, equals: '0.30000000000000004' },
        {
          sql: `SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'products'::regclass AND attname = 'price'`,
          equals: 'numeric(10,2)',
        },
      ],
      reveal: {
        correct: 'float_eq = false, numeric_eq = true.',
        why:
          '`float8` is binary floating point, which cannot represent 0.1, 0.2 or 0.3 exactly — the ' +
          'sum lands on 0.30000000000000004, so the equality against 0.3 is *false*. `numeric` is ' +
          'exact decimal: 0.1 + 0.2 is exactly 0.3 and the equality is *true*. Nothing about the ' +
          'query changed — only the type of the literals — and the answer flipped. This is why ' +
          'money lives in `numeric` here: `products.price` is `numeric(10,2)`, so sums and ' +
          'equality on prices are exact, and a rounding ghost never creeps into a total.',
        reproduceSql:
          `SELECT 0.1::float8 + 0.2::float8   AS float_sum,   -- 0.30000000000000004\n` +
          `       0.1::numeric + 0.2::numeric AS numeric_sum; -- exactly 0.3`,
      },
    },
    {
      id: 'q2',
      kind: 'predict-output',
      prompt:
        'The column’s type decides what "equal" means. `users.email` is `citext` ' +
        '(case-insensitive); `users.full_name` is plain `text` (case-sensitive). Both lookups use ' +
        'an UPPERCASE literal. Predict the two counts:\n\n' +
        '```sql\nSELECT (SELECT count(*) FROM users WHERE email     = \'ADA@EXAMPLE.COM\') AS by_email,\n' +
        '       (SELECT count(*) FROM users WHERE full_name = \'ADA LOVELACE\')    AS by_name;\n```',
      sql: `SELECT (SELECT count(*) FROM users WHERE email = 'ADA@EXAMPLE.COM') AS by_email, (SELECT count(*) FROM users WHERE full_name = 'ADA LOVELACE') AS by_name`,
      expected: { columns: ['by_email', 'by_name'], rows: [[1, 0]] },
      themes: ['set-based-thinking'],
      // Pin: citext email matches despite case (1), text name does not (0) but the exact case does (1),
      // and confirm the two columns' types so the contrast is anchored, not asserted.
      verify: [
        { sql: `SELECT count(*)::text FROM users WHERE email = 'ADA@EXAMPLE.COM'`, equals: '1' },
        { sql: `SELECT count(*)::text FROM users WHERE full_name = 'ADA LOVELACE'`, equals: '0' },
        { sql: `SELECT count(*)::text FROM users WHERE full_name = 'Ada Lovelace'`, equals: '1' },
        {
          sql: `SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'users'::regclass AND attname = 'email'`,
          equals: 'citext',
        },
      ],
      reveal: {
        correct: 'by_email = 1, by_name = 0.',
        why:
          '`email` is `citext`, so equality ignores case: `\'ADA@EXAMPLE.COM\'` matches the stored ' +
          '`ada@example.com` and finds Ada (id 1). `full_name` is plain `text`, where equality is ' +
          'case-sensitive, so `\'ADA LOVELACE\'` matches nothing — the stored value is `\'Ada ' +
          'Lovelace\'`, and only that exact casing would match. Same query shape, same data, ' +
          'opposite result, decided purely by the column type. `citext` is why email lookups and ' +
          'the UNIQUE-email rule both work regardless of how the address was typed.',
        reproduceSql:
          `SELECT id, email, full_name FROM users WHERE email = 'ADA@EXAMPLE.COM';   -- citext: found\n` +
          `SELECT id FROM users WHERE full_name = 'ADA LOVELACE';                    -- text: 0 rows\n` +
          `SELECT id FROM users WHERE full_name = 'Ada Lovelace';                    -- text: exact case matches`,
      },
    },
    {
      id: 'q3',
      kind: 'predict-error',
      prompt:
        '`orders.status` is `text`, but constrained by `CHECK (status IN (\'pending\', \'paid\', ' +
        '\'shipped\', \'delivered\', \'cancelled\'))`. This inserts an order with status ' +
        '`\'refunded\'` — a plausible word, but not one of the five. Does it run, or does it fail?\n\n' +
        '```sql\nINSERT INTO orders (user_id, status, total, placed_at)\n' +
        'VALUES (1, \'refunded\', 10.00, now());\n```',
      sql: `INSERT INTO orders (user_id, status, total, placed_at) VALUES (1, 'refunded', 10.00, now())`,
      runs: false,
      sqlState: '23514',
      themes: ['set-based-thinking'],
      // Pin the five legal values (so the reveal's list is true) and that 'refunded' isn't among them.
      verify: [
        { sql: `SELECT string_agg(DISTINCT status, ',' ORDER BY status) FROM orders`, equals: 'cancelled,delivered,paid,pending,shipped' },
        {
          sql: `SELECT (count(*) = 0)::text FROM orders WHERE status = 'refunded'`,
          equals: 'true',
        },
      ],
      reveal: {
        correct: 'It fails: ERROR 23514 — the row violates the check constraint on orders.status.',
        why:
          'The CHECK turns a plain `text` column into a closed set of exactly five legal statuses. ' +
          '`\'refunded\'` is a perfectly valid string, but it is not one of the five, so the ' +
          'constraint rejects the write with a check-violation (23514) and the row never lands. ' +
          'This is the type and a constraint working together: `text` alone would have accepted ' +
          'any string — including typos like `\'shpped\'` — but the CHECK narrows it to the values ' +
          'that actually mean something to the application. Note the *payments* table is where a ' +
          'refund is modelled (a negative amount), not an order status.',
        reproduceSql:
          `-- A status from the allowed set is accepted:\n` +
          `INSERT INTO orders (user_id, status, total, placed_at)\n` +
          `VALUES (1, 'pending', 10.00, now());\n` +
          `-- (rolled back by the reseed before the next question)`,
      },
    },
    {
      id: 'q4',
      kind: 'write-query',
      prompt:
        '`users.preferences` is `jsonb`. Return the `id` and `email` of every user whose stored ' +
        'preferences set `"theme"` to `"dark"`. Extract the value with `preferences->>\'theme\'`. ' +
        'Order by `id`.',
      referenceSql: `SELECT id, email FROM users WHERE preferences->>'theme' = 'dark' ORDER BY id`,
      compare: { orderMatters: true },
      themes: ['set-based-thinking', 'null-correctness'],
      // Pin the exact dark-theme set {1,5,9}, and that a missing/NULL doc yields NULL (id 4) so the
      // = 'dark' test correctly drops it rather than erroring.
      verify: [
        { sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM users WHERE preferences->>'theme' = 'dark'`, equals: '1,5,9' },
        { sql: `SELECT count(*)::text FROM users WHERE preferences->>'theme' = 'dark'`, equals: '3' },
        { sql: `SELECT (preferences->>'theme' IS NULL)::text FROM users WHERE id = 4`, equals: 'true' },
      ],
      reveal: {
        correct: `SELECT id, email FROM users WHERE preferences->>'theme' = 'dark' ORDER BY id;`,
        why:
          '`preferences->>\'theme\'` reaches into the jsonb document and pulls out the `theme` value ' +
          'as text; comparing it to `\'dark\'` keeps the three users who set it — ids 1, 5 and 9. ' +
          'The quiet correctness here is the NULL handling: user 4’s `preferences` is NULL and ' +
          'other users simply have no `theme` key, so `->>\'theme\'` returns NULL for them — not an ' +
          'error — and `NULL = \'dark\'` is UNKNOWN, so WHERE drops those rows exactly as you want ' +
          '(that is the three-valued logic from 0.4, now over jsonb). Extracting a missing key is ' +
          'safe by design; it just yields the absence, NULL.',
        reproduceSql:
          `SELECT id, email, preferences->>'theme' AS theme\n` +
          `FROM users ORDER BY id;   -- see who has 'dark', who has another theme, who has NULL`,
      },
    },
  ],
};
