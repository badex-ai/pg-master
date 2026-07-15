/**
 * Sample lesson — Tier 1 · Unit 1.1 (SELECT fundamentals).
 *
 * This is the first authored lesson and the fixture that proves the content model (3.1) is
 * usable end to end: a real teach block, a worked example, and two question kinds
 * (`write-query` graded against the seed, and a `multiple-choice` trap). It runs against the
 * base seed (no `setupSql`). Reference SQL targets the seeded `users` table (see DATASET.md).
 */

import type { Lesson } from '@/lib/content/types';

export const tier1Select: Lesson = {
  id: 'tier1.select',
  unit: '1.1',
  tier: 1,
  title: 'SELECT fundamentals',
  teach: `## Selecting columns

A \`SELECT\` names the columns you want and the table to read them from. \`SELECT *\` returns
every column in table order; naming columns explicitly is clearer and stable if the table
later gains columns.

Column **aliases** rename a column in the output with \`AS\` (the \`AS\` is optional):

\`\`\`sql
SELECT full_name AS name, city FROM users;
\`\`\`

You can also compute derived columns in the select list — expressions, function calls, and
literals are all valid outputs, not just bare columns.`,
  exampleSql: `SELECT id, full_name, city, status FROM users;`,
  questions: [
    {
      id: 'q1',
      kind: 'write-query',
      prompt:
        'Return the `email` and `city` of every user whose `status` is `active`. ' +
        'Column names and values both matter; row order does not.',
      referenceSql: `SELECT email, city FROM users WHERE status = 'active'`,
      // Default comparison (unordered set, names must match) is exactly right here.
      themes: ['set-based-thinking'],
      // A question whose oracle returns nothing would "pass" for a learner who selects nothing.
      verify: [{ sql: `SELECT (count(*) > 0)::text FROM users WHERE status = 'active'`, equals: 'true' }],
      reveal: {
        correct: `SELECT email, city FROM users WHERE status = 'active';`,
        why:
          'A single-table SELECT projects the two named columns and WHERE filters rows before ' +
          'projection (logical order: FROM → WHERE → SELECT). No ordering is requested, so the ' +
          'result is an unordered set of the matching rows.',
        reproduceSql: `SELECT email, city FROM users WHERE status = 'active';`,
      },
    },
    {
      id: 'q2',
      kind: 'multiple-choice',
      prompt:
        'The `users` table has 10 rows, one of which (id 4) has a NULL `full_name`. ' +
        'What does `SELECT COUNT(full_name) FROM users;` return?',
      choices: ['10', '9', '1', 'NULL'],
      answerIndex: 1,
      themes: ['null-correctness'],
      // The prompt states the row count and which id is NULL; the answer is the difference.
      verify: [
        { sql: `SELECT count(*)::text FROM users`, equals: '10' },
        { sql: `SELECT count(*)::text FROM users WHERE full_name IS NULL`, equals: '1' },
        { sql: `SELECT id::text FROM users WHERE full_name IS NULL`, equals: '4' },
        { sql: `SELECT count(full_name)::text FROM users`, equals: '9' },
      ],
      reveal: {
        correct: '9',
        why:
          'COUNT(column) counts only non-NULL values of that column, so the one NULL full_name ' +
          'is skipped: 10 − 1 = 9. This is the classic COUNT(nullable) trap.',
        distractors: [
          '10 would be COUNT(*), which counts rows regardless of NULLs.',
          '1 is the number of NULLs, i.e. the rows COUNT(full_name) skips — the inverse.',
          'COUNT never returns NULL; with no rows it returns 0.',
        ],
        reproduceSql:
          `SELECT COUNT(*) AS all_rows, COUNT(full_name) AS non_null_names FROM users;`,
      },
    },
    {
      id: 'q3',
      kind: 'predict-output',
      prompt:
        'One user (id 4) has a NULL `full_name`. What rows does this return?\n\n' +
        '```sql\nSELECT id FROM users WHERE full_name = NULL;\n```',
      sql: `SELECT id FROM users WHERE full_name = NULL`,
      expected: { columns: ['id'], rows: [] },
      themes: ['null-correctness', 'logical-eval-order'],
      // Zero rows is a NULL semantic, true of any seed. That id 4 is the NULL row is not — and the
      // reveal promises `IS NULL` returns it, so the lesson breaks if the seed moves the NULL.
      verify: [
        { sql: `SELECT id::text FROM users WHERE full_name IS NULL`, equals: '4' },
        { sql: `SELECT count(*)::text FROM users WHERE full_name = NULL`, equals: '0' },
      ],
      reveal: {
        correct: 'Zero rows.',
        why:
          'A comparison with NULL using `=` evaluates to UNKNOWN, never TRUE, so WHERE keeps no ' +
          'rows — even the row whose full_name really is NULL. NULL means "unknown", and unknown ' +
          '= unknown is not true. To match NULLs you must use `IS NULL`, which returns id 4.',
        reproduceSql: `SELECT id FROM users WHERE full_name IS NULL;`,
      },
    },
  ],
};
