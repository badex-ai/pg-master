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
        'The `users` table has 10 rows, two of which have a NULL `full_name`. ' +
        'How many rows does `SELECT COUNT(full_name) FROM users;` return as its count?',
      choices: ['10', '8', '2', 'NULL'],
      answerIndex: 1, // 8
      themes: ['null-correctness'],
      reveal: {
        correct: '8',
        why:
          'COUNT(column) counts only non-NULL values of that column, so the two NULL full_names ' +
          'are skipped: 10 − 2 = 8. This is the classic COUNT(nullable) trap.',
        distractors: [
          '10 would be COUNT(*), which counts rows regardless of NULLs.',
          '2 is the number of NULLs, i.e. the rows COUNT(full_name) skips — the inverse.',
          'COUNT never returns NULL; with no rows it returns 0.',
        ],
        reproduceSql:
          `SELECT COUNT(*) AS all_rows, COUNT(full_name) AS non_null_names FROM users;`,
      },
    },
  ],
};
