/**
 * Tier 1 · Unit 1.2 — Filtering with WHERE.
 *
 * Follows 1.1 (SELECT) with the row-filtering half of a query: comparison operators, BETWEEN,
 * IN / NOT IN, LIKE / ILIKE, and boolean composition with precedence. The centrepiece is the
 * dataset's single most important trap — `NOT IN (subquery that contains a NULL)` returns no
 * rows (order 105 is a guest order with a NULL user_id, per DATASET.md). Runs against the base
 * seed (no setupSql).
 */

import type { Lesson } from '@/lib/content/types';

export const tier1Where: Lesson = {
  id: 'tier1.where',
  unit: '1.2',
  tier: 1,
  title: 'Filtering with WHERE',
  teach: `## Keeping only the rows you want

\`WHERE\` runs after \`FROM\` and before \`SELECT\` (logical order: FROM → WHERE → SELECT). It
keeps a row only when its condition evaluates to **TRUE** — not FALSE, and crucially not
**UNKNOWN**, the third truth value NULL produces.

**Comparison and range.** The usual operators (\`=\`, \`<>\`, \`<\`, \`>=\`, …) plus two range shorthands:

\`\`\`sql
SELECT name, price FROM products WHERE price BETWEEN 50 AND 150;   -- inclusive on BOTH ends
SELECT id FROM users WHERE status IN ('active', 'banned');        -- membership
\`\`\`

\`BETWEEN a AND b\` is exactly \`>= a AND <= b\` — both bounds included. That inclusive upper
bound is a classic off-by-one on ranges you think of as half-open.

**Pattern matching.** \`LIKE\` is case-sensitive; \`_\` matches one character, \`%\` matches any
run. \`ILIKE\` is the case-insensitive form. Note the store's \`email\` column is \`citext\`, so
its comparisons are *already* case-insensitive — \`LIKE\` on a citext behaves like \`ILIKE\`.

There is also \`SIMILAR TO\` — SQL-standard regex-lite — but in practice reach for \`LIKE\` or
Postgres's \`~\` regex operator instead; \`SIMILAR TO\` is rarely the clearest tool.

**Boolean composition — parenthesize.** \`NOT\` binds tightest, then \`AND\`, then \`OR\`. So
\`a OR b AND c\` parses as \`a OR (b AND c)\`. When you mean \`(a OR b) AND c\`, the parentheses
are not optional.

**The NULL trap.** \`NOT IN (…)\` is a hazard the moment the list can contain a NULL: with a
NULL present, \`NOT IN\` can never be TRUE — each row is either FALSE (it genuinely matches a
non-NULL member) or UNKNOWN (poisoned by the NULL) — so the query yields nothing. This is the
most expensive beginner mistake in the whole track — the quiz makes you meet it.`,
  exampleSql: `SELECT id, full_name, status, city
FROM users
WHERE status = 'active' AND country = 'USA';`,
  questions: [
    {
      id: 'q1',
      kind: 'write-query',
      prompt:
        'Return the `name` and `price` of every product priced between 50 and 150 inclusive. ' +
        'Column names and values matter; row order does not.',
      referenceSql: `SELECT name, price FROM products WHERE price BETWEEN 50 AND 150`,
      themes: ['set-based-thinking'],
      // The reveal names the four qualifying products (by price) and the two below-50 rows it
      // says are excluded, and asserts BETWEEN is inclusive — so pin the exact qualifying set,
      // that the top boundary value (120.00) is included, and the below-50 count.
      verify: [
        { sql: `SELECT count(*)::text FROM products WHERE price BETWEEN 50 AND 150`, equals: '4' },
        { sql: `SELECT count(*)::text FROM products WHERE price = 120.00`, equals: '1' },
        {
          sql: `SELECT string_agg(price::text, ',' ORDER BY price DESC) FROM products WHERE price BETWEEN 50 AND 150`,
          equals: '120.00,89.99,59.50,59.00',
        },
        { sql: `SELECT count(*)::text FROM products WHERE price < 50`, equals: '2' },
      ],
      reveal: {
        correct: `SELECT name, price FROM products WHERE price BETWEEN 50 AND 150;`,
        why:
          'BETWEEN 50 AND 150 is shorthand for price >= 50 AND price <= 150 — both bounds are ' +
          'inclusive. Four products qualify: the Mechanical Keyboard (120.00), the Compact 60% ' +
          'Keyboard (89.99), the Ergonomic Mouse (59.50), and PostgreSQL Internals (59.00). The ' +
          '45.00 C book and the 19.99 gadget fall below 50 and are excluded.',
        reproduceSql: `SELECT name, price FROM products WHERE price BETWEEN 50 AND 150 ORDER BY price;`,
      },
    },
    {
      id: 'q2',
      kind: 'predict-output',
      prompt:
        'One order (id 105) is a guest checkout with a NULL `user_id`. ' +
        'Which users have placed no orders at all? Predict what this returns:\n\n' +
        '```sql\nSELECT id FROM users\nWHERE id NOT IN (SELECT user_id FROM orders);\n```',
      sql: `SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM orders)`,
      expected: { columns: ['id'], rows: [] },
      themes: ['null-correctness', 'logical-eval-order'],
      // Zero rows is the whole lesson. Also pin the facts the reveal/prompt lean on: there is
      // EXACTLY ONE guest order and its id is 105 (the single-row rule enforces "exactly one"),
      // and the correct answer (users with no orders) is non-empty — so the learner sees the trap
      // swallowed real results, not that there happened to be none.
      verify: [
        { sql: `SELECT count(*)::text FROM users WHERE id NOT IN (SELECT user_id FROM orders)`, equals: '0' },
        { sql: `SELECT id::text FROM orders WHERE user_id IS NULL`, equals: '105' },
        {
          sql: `SELECT (count(*) > 0)::text FROM users u WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)`,
          equals: 'true',
        },
      ],
      reveal: {
        correct: 'Zero rows — even though several users genuinely have no orders.',
        why:
          'The subquery `SELECT user_id FROM orders` includes a NULL (order 105 is a guest order). ' +
          '`id NOT IN (…, NULL)` expands to `id <> … AND id <> NULL`, and `id <> NULL` is UNKNOWN ' +
          'for every row, so the whole condition is never TRUE and no row is kept. The fix is ' +
          '`NOT EXISTS`, which is NULL-safe and returns the users who really have no orders.',
        reproduceSql:
          `SELECT id FROM users u\nWHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)\nORDER BY id;`,
      },
    },
    {
      id: 'q3',
      kind: 'multiple-choice',
      prompt:
        'The `email` column is of type `citext` (case-insensitive text). ' +
        'How many rows does `SELECT * FROM users WHERE email LIKE \'ADA@%\';` return?',
      // Bare values: annotated choices would state the mechanism and leak the answer (the reveal's
      // job). Rationale lives in reveal.distractors.
      choices: ['0', '1', '10', 'An error'],
      answerIndex: 1,
      themes: ['portability'],
      // The claim is that LIKE on this citext column matches 'ADA@%' case-insensitively → the one
      // ada@example.com row, AND that the same pattern cast to text returns 0 (the reveal's central
      // contrast). Pin both directly.
      verify: [
        { sql: `SELECT count(*)::text FROM users WHERE email LIKE 'ADA@%'`, equals: '1' },
        { sql: `SELECT count(*)::text FROM users WHERE email = 'ada@example.com'`, equals: '1' },
        { sql: `SELECT count(*)::text FROM users WHERE email::text LIKE 'ADA@%'`, equals: '0' },
      ],
      reveal: {
        correct: '1 (citext folds case, so the uppercase pattern matches).',
        why:
          'On a normal `text` column `LIKE \'ADA@%\'` is case-sensitive and would miss the lowercase ' +
          'stored value. But `email` is `citext`: its operators, including LIKE, fold case, so the ' +
          'uppercase pattern matches `ada@example.com`. This is a property of the column\'s TYPE, ' +
          'not of LIKE — the same pattern against a text column returns 0 rows.',
        distractors: [
          '0 would be right for a plain text column; citext changes the comparison semantics.',
          '10 would require the pattern to match every email — it only matches the one starting "ada@".',
          'It runs fine: LIKE is defined for citext, so there is no type error.',
        ],
        reproduceSql:
          `SELECT email FROM users WHERE email LIKE 'ADA@%';   -- citext folds case\n` +
          `SELECT email FROM users WHERE email::text LIKE 'ADA@%';  -- cast to text: 0 rows`,
      },
    },
    {
      id: 'q4',
      kind: 'predict-output',
      prompt:
        'Predict the rows. Watch the precedence — there are no parentheses:\n\n' +
        '```sql\nSELECT id FROM users\nWHERE country = \'UK\' OR country = \'USA\' AND status = \'banned\'\nORDER BY id;\n```',
      sql: `SELECT id FROM users WHERE country = 'UK' OR country = 'USA' AND status = 'banned' ORDER BY id`,
      // AND binds tighter, so this is: UK (any status)  OR  (USA AND banned).
      // UK users are ids 1 and 8. No USA user is banned (row 6 banned is Netherlands). So {1, 8}.
      expected: { columns: ['id'], rows: [[1], [8]] },
      themes: ['logical-eval-order'],
      verify: [
        {
          sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM users WHERE country = 'UK' OR country = 'USA' AND status = 'banned'`,
          equals: '1,8',
        },
        // Contrast fact the reveal cites: the fully-parenthesized (UK or USA) AND banned is empty,
        // because the one banned user is in the Netherlands.
        {
          sql: `SELECT count(*)::text FROM users WHERE (country = 'UK' OR country = 'USA') AND status = 'banned'`,
          equals: '0',
        },
        // The reveal names the sole banned user (Edsger, NL) and the UK id↔name pairings.
        {
          sql: `SELECT string_agg(full_name || ':' || country, ',') FROM users WHERE status = 'banned'`,
          equals: 'Edsger Dijkstra:Netherlands',
        },
        {
          sql: `SELECT string_agg(full_name, ',' ORDER BY id) FROM users WHERE country = 'UK'`,
          equals: 'Ada Lovelace,Alan Turing',
        },
      ],
      reveal: {
        correct: 'Two rows: ids 1 and 8.',
        why:
          'AND binds tighter than OR, so the condition parses as ' +
          '`country = \'UK\' OR (country = \'USA\' AND status = \'banned\')`. The UK branch alone ' +
          'matches Ada (1) and Alan (8) regardless of status; the USA-and-banned branch matches ' +
          'nobody, because the only banned user (Edsger, id 6) is in the Netherlands. Had you meant ' +
          '`(country = \'UK\' OR country = \'USA\') AND status = \'banned\'`, the result would be ' +
          'empty — a completely different query. Parenthesize when mixing AND with OR.',
        reproduceSql:
          `SELECT id, country, status FROM users\n` +
          `WHERE country = 'UK' OR country = 'USA' AND status = 'banned'\n` +
          `ORDER BY id;`,
      },
    },
    {
      id: 'q5',
      kind: 'write-query',
      prompt:
        'One product name contains a literal percent sign: `Compact 60% Keyboard`. ' +
        'Return the `name` of every product whose name contains the substring `60%` — the ' +
        'percent must be matched *literally*, not as a wildcard. Return the `name` column.',
      // `\%` is an escaped literal percent inside LIKE; the surrounding `%` are wildcards. So this
      // matches names containing the three characters "60%".
      referenceSql: String.raw`SELECT name FROM products WHERE name LIKE '%60\%%'`,
      themes: ['set-based-thinking', 'portability'],
      // The reveal asserts exactly one product matches, and that forgetting to escape (matching
      // '%60%') would wrongly also catch the '60' in a non-percent name — but here no other name
      // contains '60', so pin: escaped match = 1, and that '60%' literally occurs once.
      verify: [
        { sql: String.raw`SELECT count(*)::text FROM products WHERE name LIKE '%60\%%'`, equals: '1' },
        { sql: `SELECT count(*)::text FROM products WHERE name = 'Compact 60% Keyboard'`, equals: '1' },
      ],
      reveal: {
        correct: String.raw`SELECT name FROM products WHERE name LIKE '%60\%%';`,
        why:
          'Inside a LIKE pattern, `%` and `_` are wildcards; to match a literal percent you escape ' +
          'it as `\\%` (the default LIKE escape character is the backslash). The pattern `%60\\%%` ' +
          'reads as: any run, then the literal characters `6`, `0`, `%`, then any run — so it ' +
          'matches `Compact 60% Keyboard` and nothing else. Drop the escape (`%60%`) and the `%` ' +
          'after `60` becomes a wildcard again, changing what you asked for.',
        reproduceSql:
          String.raw`SELECT name FROM products WHERE name LIKE '%60\%%';` + '\n' +
          `-- Contrast: this treats the % as a wildcard (matches "contains 60"):\n` +
          `SELECT name FROM products WHERE name LIKE '%60%';`,
      },
    },
  ],
};
