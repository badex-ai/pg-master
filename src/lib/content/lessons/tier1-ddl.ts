/**
 * Tier 1 · Unit 1.8 — Creating and altering tables (DDL).
 *
 * CREATE TABLE, ALTER TABLE, DROP, and the constraint checks that run when you change a table that
 * already holds data. Uses probe-graded write-query questions (see StateProbe in content/types.ts):
 * DDL has no result set, so answers are graded by the resulting *shape*, observed through
 * information_schema and pg_constraint rather than by reading rows.
 *
 * Dataset centrepieces: user 4 has a NULL full_name (so SET NOT NULL fails), products 5/6/9 have
 * non-integer prices 89.99/59.50/19.99 (so ALTER TYPE int silently rounds them), min(price) is
 * 19.99 (so a CHECK price > 100 is rejected by existing rows), and orders is referenced by
 * order_items/shipments/payments (so a bare DROP is blocked). Runs against the base seed.
 */

import type { Lesson } from '@/lib/content/types';

export const tier1Ddl: Lesson = {
  id: 'tier1.ddl',
  unit: '1.8',
  tier: 1,
  title: 'Creating and altering tables',
  teach: `## Defining and changing the shape

DDL — Data Definition Language — is the SQL that describes what the data *is*, rather than what
it holds.

- **CREATE TABLE** — declare columns, types, and the constraints that make invalid rows
  impossible.
- **ALTER TABLE** — add, drop, rename, or retype a column; add or drop a constraint.
- **DROP TABLE** — remove it entirely.

**Altering a table that already has rows is where it gets interesting.** An empty table accepts
almost any definition. A populated one must satisfy the new rule *for every existing row*, and
Postgres checks before it commits:

- \`ADD COLUMN ... NOT NULL\` with no \`DEFAULT\` fails — the existing rows would need a value
  and have none.
- \`ALTER COLUMN ... SET NOT NULL\` fails if any row is currently NULL there.
- \`ADD CONSTRAINT ... CHECK (...)\` fails if any existing row violates it.

These rejections are the schema doing its job. The fix is to repair the data first (backfill,
supply a DEFAULT), then apply the constraint.

**The dangerous DDL is the kind that succeeds.** A rejected statement tells you something is
wrong. The ones to fear run cleanly and take data with them: retyping a \`numeric\` column to
\`int\` rounds every value silently, and \`DROP COLUMN\` removes the column's constraints along
with it. Neither asks for confirmation, and neither is recoverable once committed.

**Dependencies are tracked, so drops are refused rather than cascading by surprise.** A table
another table references by FK will not drop; you get an explicit error naming the dependency.
\`CASCADE\` overrides that and takes the dependents with it — occasionally what you want, and
worth being very sure about.

**CREATE TABLE AS copies rows, not rules.** It builds a table from a query's output with matching
column types, and no primary key, no NOT NULL, no CHECK, no foreign keys. Convenient for a
scratch copy; not a way to clone a table's design.`,
  exampleSql: `ALTER TABLE products
ADD COLUMN discontinued boolean NOT NULL DEFAULT false;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'discontinued';`,
  questions: [
    {
      id: 'q1',
      kind: 'predict-error',
      prompt:
        'The `users` table has 10 rows, and one of them (user 4) has a NULL `full_name`. ' +
        'Does this run?\n\n```sql\nALTER TABLE users ALTER COLUMN full_name SET NOT NULL;\n```',
      sql: `ALTER TABLE users ALTER COLUMN full_name SET NOT NULL`,
      runs: false,
      sqlState: '23502',
      themes: ['null-correctness'],
      verify: [
        { sql: `SELECT count(*)::text FROM users WHERE full_name IS NULL`, equals: '1' },
        { sql: `SELECT count(*)::text FROM users`, equals: '10' },
      ],
      reveal: {
        correct:
          'No — `column "full_name" of relation "users" contains null values` (SQLSTATE 23502).',
        why:
          'SET NOT NULL is a promise about every row, present and future, so Postgres validates it ' +
          'against the existing data before accepting it. One row (user 4) is NULL, and one is ' +
          'enough. Nothing is changed — DDL is transactional here, so the table is left exactly as ' +
          'it was. To make this work you must first decide what that row should say: backfill it ' +
          'with a real value or a placeholder, then re-run the ALTER. The order matters and cannot ' +
          'be avoided: the constraint cannot be added "and fixed later".',
        reproduceSql: `SELECT id, full_name FROM users WHERE full_name IS NULL;`,
      },
    },
    {
      id: 'q2',
      kind: 'spot-the-bug',
      prompt:
        'A migration is supposed to switch prices to whole units. It runs without error and the ' +
        'migration is marked successful:\n\n' +
        '```sql\nALTER TABLE products ALTER COLUMN price TYPE int;\n```\n\n' +
        'What has it done to the data?',
      sql: `ALTER TABLE products ALTER COLUMN price TYPE int`,
      themes: ['cost-of-writes'],
      verify: [
        {
          sql: `SELECT string_agg(id::text || '=' || price::text, ',' ORDER BY id) FROM products WHERE id IN (5, 6, 9)`,
          equals: '5=89.99,6=59.50,9=19.99',
        },
        { sql: `SELECT count(*)::text FROM products WHERE price <> round(price)`, equals: '3' },
      ],
      reveal: {
        correct:
          'It silently rounded every non-integer price, losing the fractional part permanently: ' +
          '89.99 → 90, 59.50 → 60, 19.99 → 20.',
        why:
          'Changing a column type applies an assignment cast to every existing row. numeric → int ' +
          'is a *lossy* cast that Postgres performs without complaint, rounding to the nearest ' +
          'integer (half away from zero, so 59.50 becomes 60). Three of the ten products had ' +
          'fractional prices and all three were rewritten. Nothing errored, nothing warned, and ' +
          'the original values are not recoverable after commit — a restore from backup is the only ' +
          'way back. This is the DDL failure mode worth internalising: the statement that *fails* ' +
          'is the safe one. Before any type change, run the cast as a SELECT first ' +
          '(`SELECT price, price::int FROM products`) and look at the rows that differ.',
        reproduceSql: `SELECT id, price, price::int AS would_become\nFROM products\nWHERE price <> round(price)\nORDER BY id;`,
      },
    },
    {
      id: 'q3',
      kind: 'predict-error',
      prompt:
        'The cheapest product costs 19.99. Does this run?\n\n' +
        '```sql\nALTER TABLE products ADD CONSTRAINT price_min CHECK (price > 100);\n```',
      sql: `ALTER TABLE products ADD CONSTRAINT price_min CHECK (price > 100)`,
      runs: false,
      sqlState: '23514',
      themes: ['cost-of-writes'],
      verify: [
        { sql: `SELECT min(price)::text FROM products`, equals: '19.99' },
        { sql: `SELECT count(*)::text FROM products WHERE price <= 100`, equals: '5' },
      ],
      reveal: {
        correct:
          'No — `check constraint "price_min" of relation "products" is violated by some row` ' +
          '(SQLSTATE 23514).',
        why:
          'Adding a CHECK validates it against every existing row, and five products are priced at ' +
          '100 or below. A constraint that the current data does not satisfy would be a lie about ' +
          'the table, so Postgres refuses it rather than accepting a rule it is already breaking. ' +
          'Postgres does offer an escape hatch for exactly this situation — `ADD CONSTRAINT ... ' +
          'NOT VALID` records the constraint and enforces it for new writes while leaving existing ' +
          'rows unchecked, which is how large tables get constraints added without a long lock. ' +
          'That is a deliberate choice to accept known-bad history, not a way to skip the problem.',
        reproduceSql: `SELECT id, name, price FROM products WHERE price <= 100 ORDER BY price;`,
      },
    },
    {
      id: 'q4',
      kind: 'multiple-choice',
      prompt:
        'You no longer need the `status` column on `users`, which carries a CHECK constraint ' +
        "(`status IN ('active', 'inactive', 'banned')`). You run:\n\n" +
        '```sql\nALTER TABLE users DROP COLUMN status;\n```\n\n' +
        'What happens to that CHECK constraint?',
      choices: [
        'It is dropped along with the column, automatically and silently.',
        'The statement is refused until the constraint is dropped explicitly first.',
        'The constraint remains and now applies to no column, so every future INSERT fails.',
        'The column is dropped but the constraint blocks it, leaving the table in a half-altered state.',
      ],
      answerIndex: 0,
      themes: ['cost-of-writes'],
      verify: [
        {
          sql: `SELECT count(*)::text FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = 'users_status_check'`,
          equals: '1',
        },
        {
          sql: `SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'users'`,
          equals: 'id,email,full_name,country,city,status,created_at,preferences',
        },
      ],
      reveal: {
        correct: 'It is dropped with the column, automatically and silently.',
        why:
          'Postgres tracks dependencies between objects. A constraint that references only the ' +
          'dropped column depends on it and cannot outlive it, so it goes too — no error, no ' +
          'notice. This is the right behaviour and also a quiet way to lose a rule you meant to ' +
          'keep: the invariant that status must be one of three values is now gone, and if the ' +
          'column is ever re-added it comes back unconstrained. Note the contrast with a FK ' +
          'dependency *from another table*, which is refused rather than cascaded — Postgres ' +
          'silently removes what belongs to the object you dropped, and refuses when something ' +
          'else would be affected.',
        distractors: [
          'No explicit drop is needed; the dependency is resolved for you.',
          'A constraint cannot outlive the only column it references, so it is never left dangling.',
          'DDL here is transactional — a statement either fully applies or fully rolls back, never half.',
        ],
        reproduceSql:
          `SELECT conname, pg_get_constraintdef(oid)\nFROM pg_constraint\nWHERE conrelid = 'users'::regclass\nORDER BY conname;`,
      },
    },
    {
      id: 'q5',
      kind: 'predict-error',
      prompt:
        '`order_items`, `shipments` and `payments` all reference `orders` by foreign key. ' +
        'Does this run?\n\n```sql\nDROP TABLE orders;\n```',
      sql: `DROP TABLE orders`,
      runs: false,
      sqlState: '2BP01',
      themes: ['cost-of-writes'],
      verify: [
        {
          sql: `SELECT count(*)::text FROM pg_constraint WHERE contype = 'f' AND confrelid = 'orders'::regclass`,
          equals: '3',
        },
      ],
      reveal: {
        correct:
          'No — `cannot drop table orders because other objects depend on it` (SQLSTATE 2BP01).',
        why:
          'Three foreign keys point at orders, so dropping it would leave those columns referencing ' +
          'a table that no longer exists. Postgres refuses and names the dependents rather than ' +
          'quietly breaking them. `DROP TABLE orders CASCADE` would succeed by dropping the ' +
          'dependent *constraints* — note it drops the constraints, not the child tables, so ' +
          'order_items survives but loses the rule tying its rows to a real order. CASCADE on a ' +
          'drop is worth treating as a "prove you know what depends on this" prompt: run the ' +
          'dependency query below first.',
        reproduceSql:
          `SELECT conrelid::regclass AS dependent_table, conname\n` +
          `FROM pg_constraint\n` +
          `WHERE contype = 'f' AND confrelid = 'orders'::regclass;`,
      },
    },
    {
      id: 'q6',
      kind: 'write-query',
      prompt:
        'Add a `discontinued` column to `products`: boolean, never NULL, defaulting to false. ' +
        'The table already has 10 rows, so your statement must give them all a value.',
      referenceSql: `ALTER TABLE products ADD COLUMN discontinued boolean NOT NULL DEFAULT false`,
      probes: [
        {
          label: 'the new column definition',
          sql: `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'discontinued'`,
        },
        {
          label: 'the existing rows',
          sql: `SELECT count(*)::text AS total, count(*) FILTER (WHERE discontinued = false)::text AS defaulted FROM products`,
        },
      ],
      themes: ['cost-of-writes'],
      verify: [
        { sql: `SELECT count(*)::text FROM products`, equals: '10' },
        {
          sql: `SELECT count(*)::text FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'discontinued'`,
          equals: '0',
        },
      ],
      reveal: {
        correct: `ALTER TABLE products ADD COLUMN discontinued boolean NOT NULL DEFAULT false;`,
        why:
          'The DEFAULT is what makes NOT NULL possible here. Without it the statement is rejected — ' +
          'the ten existing rows would each need a value and have none. With it, every existing row ' +
          'is given false and the new column is immediately non-nullable. Since Postgres 11 this ' +
          'does not rewrite the table: the default is stored as metadata and materialised as rows ' +
          'are read or updated, so adding a NOT NULL column with a default to a large table is ' +
          'fast rather than a full-table lock. Your answer is judged on the column definition and ' +
          'on the existing rows having actually received the value.',
        reproduceSql:
          `SELECT column_name, data_type, is_nullable, column_default\n` +
          `FROM information_schema.columns\n` +
          `WHERE table_name = 'products' AND column_name = 'discontinued';`,
      },
    },
    {
      id: 'q7',
      kind: 'write-query',
      prompt:
        'Create a `tags` table with exactly two columns: `id`, an integer primary key the database ' +
        'generates itself (always, not overridable), and `label`, text, required and unique.',
      referenceSql: `CREATE TABLE tags (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text NOT NULL UNIQUE)`,
      probes: [
        {
          label: 'the column definitions',
          sql: `SELECT column_name, data_type, is_nullable, is_identity, identity_generation FROM information_schema.columns WHERE table_name = 'tags' ORDER BY ordinal_position`,
        },
        {
          label: 'the constraints',
          sql: `SELECT contype::text AS kind, count(*)::text AS n FROM pg_constraint WHERE conrelid = 'tags'::regclass GROUP BY contype ORDER BY contype`,
        },
      ],
      themes: ['cost-of-writes'],
      verify: [
        {
          sql: `SELECT count(*)::text FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tags'`,
          equals: '0',
        },
        { sql: `SELECT count(*)::text FROM information_schema.tables WHERE table_schema = 'public'`, equals: '10' },
      ],
      reveal: {
        correct:
          `CREATE TABLE tags (\n  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  label text NOT NULL UNIQUE\n);`,
        why:
          'GENERATED ALWAYS AS IDENTITY is what "always, not overridable" means: the database owns ' +
          'the value and rejects a caller-supplied id outright, unlike GENERATED BY DEFAULT which ' +
          'permits an override and lets the sequence fall behind the data. PRIMARY KEY implies NOT ' +
          'NULL, and UNIQUE on label creates a backing unique index — so this two-column ' +
          'declaration produces four constraints in total. Both are checked here: the column ' +
          'definitions (types, nullability, identity) and the constraint set, because a table ' +
          'with the right columns and the wrong rules is not the table that was asked for.',
        reproduceSql:
          `CREATE TABLE tags (\n` +
          `  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n` +
          `  label text NOT NULL UNIQUE\n` +
          `);\n\n` +
          `SELECT conname, contype, pg_get_constraintdef(oid)\n` +
          `FROM pg_constraint\n` +
          `WHERE conrelid = 'tags'::regclass\n` +
          `ORDER BY conname;`,
      },
    },
  ],
};
