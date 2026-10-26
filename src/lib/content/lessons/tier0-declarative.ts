/**
 * Tier 0 · Unit 0.3 — SQL is declarative, not imperative.
 *
 * The conceptual capstone of the mental-model tier. You state WHAT set you want, not HOW to
 * compute it; the engine is free to choose any execution path that yields that set. Taught this
 * way: lead with a NEGATIVE, honestly-pinnable claim (no ORDER BY ⇒ no guaranteed
 * row order — asking "what order" is itself the imperative mistake), then a POSITIVE demonstration
 * (the same set reached by two structurally unrelated queries, identical not by luck but by
 * contract). Deliberately does NOT show EXPLAIN — that would re-import imperative thinking and
 * collides with Tier 4.1, which is where plans are first shown. Closes teach with a forward-pointer
 * to 4.1, mirroring how 0.2 pointed here. No predict-error (nothing fails), no predict-output as a
 * spine (it implies a single "the engine does X" sequence). Base seed, no setupSql.
 */

import type { Lesson } from '@/lib/content/types';

export const tier0Declarative: Lesson = {
  id: 'tier0.declarative',
  unit: '0.3',
  tier: 0,
  title: 'SQL is declarative, not imperative',
  teach: `## You describe the result. The engine decides how to get it.

In an imperative language you write the *steps*: open the file, loop over the rows, keep a
counter, break when you hit the end. SQL is the opposite. You write a **description of the set you
want**, and the database figures out the steps for itself. \`SELECT id FROM users WHERE status =
'active'\` does not say "scan the table top to bottom testing each row." It says *"the set of ids
of active users"* — and leaves the how entirely to the engine.

This is not a stylistic nicety. It is the single idea that separates SQL from every loop you have
ever written, and two concrete consequences fall straight out of it.

### Consequence 1 — you didn't ask for an order, so you don't get one

Because a query is a description of a *set*, and a set has no order (unit 0.1), a \`SELECT\` without
\`ORDER BY\` makes **no promise whatsoever** about the sequence of the rows. Not "insertion order",
not "primary-key order", not "the order that happened to come back last time". *No promise.*

The trap is that on a small table it often *looks* ordered — you run it, the rows come back by id,
and you conclude id-order is guaranteed. It is not. The same query can return a different order
after an index is added, after the table grows, after a Postgres upgrade, or between two runs. The
rows are the same **set** every time; their sequence is unspecified. Asking "but what order do
they come in?" is itself the imperative mistake — you are reaching for a step-by-step execution
that the language never promised you. If you need an order, **state it** with \`ORDER BY\`. That is
you adding a requirement to the *description*, and now the engine must honour it.

### Consequence 2 — the same description, written differently, is the same query

If a query names a set, then any two queries that name the **same set** are equivalent — and the
engine is *required* to return the same rows for both, however differently they are written. These
two both describe "active users in the USA":

\`\`\`sql
SELECT id FROM users WHERE country = 'USA' AND status = 'active';

SELECT id FROM users
WHERE id IN (SELECT id FROM users WHERE status = 'active')
  AND country = 'USA';
\`\`\`

One is a flat predicate; the other routes through a subquery. They look nothing alike, yet they
return the identical set — ids 2, 5, 7 and 10 — **not by coincidence, but because they describe
the same thing.** The engine may execute them by entirely different internal paths and is free to
pick whichever it judges cheaper; correctness does not depend on that choice, only on the
description matching. Likewise \`WHERE country = 'USA' AND status = 'active'\` and \`WHERE status =
'active' AND country = 'USA'\` are the same query — \`AND\` is a *set of conditions*, not an ordered
list of steps, so reordering them cannot change the result.

### "Logical" meaning vs. the engine's freedom

Unit 0.2 gave you the *logical* order of evaluation (FROM → WHERE → … → ORDER BY). That order
defines what a query **means**. It is not the sequence of physical steps the engine performs. The
planner is free to reorder joins, filter early, stop as soon as a \`LIMIT\` is satisfied, or use an
index instead of scanning — anything at all, **as long as the rows it returns match the set your
description specified.** Meaning is fixed by you; method is chosen by the engine.

You do not need to see that machinery to write correct SQL — that is the whole point of a
declarative language, and it is why this unit shows you no query plans. When you *do* want to know
*how* the engine chose to execute a query — and how to make it choose better — that is
**Tier 4.1, "Reading query plans"**. Until then: describe the set, state any order you need, and
trust the engine with the rest.`,
  exampleSql: `-- Two very different-looking queries, one and the same result set.
SELECT id, city FROM users WHERE country = 'USA' AND status = 'active'
ORDER BY id;   -- the ORDER BY is you *asking* for an order; without it, none is promised`,
  questions: [
    {
      id: 'q1',
      kind: 'multiple-choice',
      prompt:
        'Consider `SELECT id FROM users WHERE status = \'banned\';`. Exactly one user is banned, so ' +
        'the query returns one row (id 6). Which of these does the query, *as written*, guarantee?',
      choices: [
        'The rows come back in ascending id order.',
        'The rows come back in the order they were inserted.',
        'Exactly which rows are returned — but nothing about the order they come in.',
        'The order is guaranteed to be identical every time you run it.',
      ],
      answerIndex: 2,
      themes: ['set-based-thinking', 'logical-eval-order'],
      // Pin the membership fact the whole question rests on: banned = exactly {6}. The claim being
      // taught (no order guarantee) is a NEGATIVE about the contract, not a runtime value to pin.
      verify: [
        { sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM users WHERE status = 'banned'`, equals: '6' },
        { sql: `SELECT count(*)::text FROM users WHERE status = 'banned'`, equals: '1' },
      ],
      reveal: {
        correct:
          'It guarantees exactly which rows come back (the set) — and makes no promise at all about ' +
          'their order.',
        why:
          'A query without `ORDER BY` describes a *set*, and a set has no order. So the engine ' +
          'guarantees the membership — here, the single banned user, id 6 — and nothing about ' +
          'sequence. With one row you cannot even see the difference, which is exactly why this is ' +
          'a trap: on small or freshly-loaded data the rows often *look* sorted by id or by ' +
          'insertion, and it is tempting to rely on that. But "looks ordered" is not "is ' +
          'guaranteed ordered". Adding an index, growing the table, or a version upgrade can all ' +
          'change the sequence. If order matters, you must *ask* for it with `ORDER BY`.',
        distractors: [
          'Ascending id order is not promised — an index or a plan change can return rows in another sequence; it only *often* looks sorted on small data.',
          'Insertion order is never a contract in SQL — tables are sets, not append logs, and the engine may return rows in any sequence.',
          'Run-to-run stability is not promised either: the same query can order rows differently across runs, plans, or versions unless ORDER BY fixes it.',
        ],
        reproduceSql:
          `-- The membership is fixed and knowable:\n` +
          `SELECT id FROM users WHERE status = 'banned';\n` +
          `-- If you need a guaranteed order, you must state it — that is you adding a requirement:\n` +
          `SELECT id FROM users WHERE status = 'active' ORDER BY id;`,
      },
    },
    {
      id: 'q2',
      kind: 'compare-approaches',
      prompt:
        'Both queries describe "the ids of active users in the USA", written two structurally ' +
        'different ways — one a flat predicate, one routed through a subquery:\n\n' +
        '```sql\n-- A:\nSELECT id FROM users WHERE country = \'USA\' AND status = \'active\';\n\n' +
        '-- B:\nSELECT id FROM users\nWHERE id IN (SELECT id FROM users WHERE status = \'active\')\n' +
        '  AND country = \'USA\';\n```\n\n' +
        'What is true of their results, and why?',
      options: [
        'A and B return the identical set of rows, because they describe the same set — the engine must agree, whatever internal path each takes.',
        'They may differ, because the subquery in B makes it evaluate in a different order.',
        'B is more correct because being explicit about "active" in a subquery is stricter.',
      ],
      // Option A is objectively correct here, so the question is graded like multiple-choice.
      answerIndex: 0,
      themes: ['set-based-thinking'],
      // Pin: both formulations yield the identical set {2,5,7,10}, proven by an empty symmetric
      // difference, and the count is 4. This is the positive "same description ⇒ same query" anchor.
      verify: [
        { sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM users WHERE country = 'USA' AND status = 'active'`, equals: '2,5,7,10' },
        {
          sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM users WHERE id IN (SELECT id FROM users WHERE status = 'active') AND country = 'USA'`,
          equals: '2,5,7,10',
        },
        {
          // symmetric difference of A and B is empty ⇒ identical sets.
          sql: `SELECT count(*)::text FROM (
            (SELECT id FROM users WHERE country = 'USA' AND status = 'active'
             EXCEPT SELECT id FROM users WHERE id IN (SELECT id FROM users WHERE status = 'active') AND country = 'USA')
            UNION ALL
            (SELECT id FROM users WHERE id IN (SELECT id FROM users WHERE status = 'active') AND country = 'USA'
             EXCEPT SELECT id FROM users WHERE country = 'USA' AND status = 'active')
          ) d`,
          equals: '0',
        },
      ],
      reveal: {
        correct:
          'A and B return the identical set — ids 2, 5, 7 and 10 — because they describe the same ' +
          'set. The engine is required to agree, whatever internal path each one takes.',
        why:
          'This is declarativeness in one example. Both queries *describe* "active users in the ' +
          'USA"; they differ only in phrasing, so they name the same set and must return the same ' +
          'rows — their symmetric difference is empty. The engine may execute A as a single filtered ' +
          'scan and B by first computing the active-users subquery, or it may rewrite B into A ' +
          'internally and run them identically; you cannot tell and you do not need to. Correctness ' +
          'rides on the *description* matching, never on the execution path. "Evaluate in a ' +
          'different order" confuses B\'s logical shape with a physical plan — the planner owns the ' +
          'plan, and it will pick whichever it judges cheaper.',
        distractors: [
          'They cannot differ: describing the same set forces the same rows. A subquery changes the phrasing, not the set — and not the "order" of anything the result depends on.',
          'Neither is "more correct": both are exact descriptions of the same set, so both are equally right. Extra syntax does not make a set stricter.',
        ],
        reproduceSql:
          `SELECT id FROM users WHERE country = 'USA' AND status = 'active' ORDER BY id;\n` +
          `-- the very same set, described through a subquery instead:\n` +
          `SELECT id FROM users\n` +
          `WHERE id IN (SELECT id FROM users WHERE status = 'active') AND country = 'USA'\n` +
          `ORDER BY id;`,
      },
    },
    {
      id: 'q3',
      kind: 'multiple-choice',
      prompt:
        'Unit 0.2 taught the *logical* order of evaluation: FROM → WHERE → GROUP BY → … → ORDER BY. ' +
        'Does that mean the database physically executes a query in exactly that sequence of steps?',
      choices: [
        'Yes — the logical order is the exact sequence of physical steps the engine runs.',
        'No — it defines what the query *means*; the engine may choose any physical plan that produces the specified result.',
        'Only for queries without a WHERE clause.',
      ],
      answerIndex: 1,
      themes: ['logical-eval-order', 'set-based-thinking'],
      // Conceptual — no seed fact to pin. The reveal names no counts/ids, so no verify[] is needed.
      reveal: {
        correct:
          'No. The logical order defines the query’s *meaning*; the engine is free to use any ' +
          'physical plan that yields the specified result.',
        why:
          'Logical order and physical execution are two different things. The logical order is a ' +
          'semantic contract — it tells you, for instance, that WHERE is applied before an ' +
          'aggregate exists, which is *why* an aggregate is illegal in WHERE (unit 0.2). It does ' +
          'not dictate the steps. The planner routinely filters early, reorders joins, uses an ' +
          'index instead of a scan, or stops as soon as a LIMIT is met — any of which departs from ' +
          '"FROM then WHERE then …" as a literal sequence — precisely because it is allowed to, as ' +
          'long as the rows it returns match what the logical order says the query *means*. Meaning ' +
          'is fixed; method is the engine’s to choose. Seeing that method is Tier 4.1’s subject.',
        distractors: [
          'The logical order is a meaning, not a step list — the engine reorders and short-circuits freely as long as the result matches.',
          'It is a semantic contract for *every* query, WHERE clause or not — the freedom to pick a physical plan is not conditional on the query’s shape.',
        ],
      },
    },
    {
      id: 'q4',
      kind: 'write-query',
      prompt:
        'Describe the set of active users in the USA. Return each such user’s `id` and `city`. ' +
        'The requirement fixes *which* rows, not their sequence — so return them in `id` order to ' +
        'make the output deterministic.',
      referenceSql: `SELECT id, city FROM users WHERE country = 'USA' AND status = 'active' ORDER BY id`,
      compare: { orderMatters: true },
      themes: ['set-based-thinking'],
      // The set is {2,5,7,10}; ORDER BY id is a total order (id is unique). Pin the ids and cities.
      verify: [
        { sql: `SELECT string_agg(id::text, ',' ORDER BY id) FROM users WHERE country = 'USA' AND status = 'active'`, equals: '2,5,7,10' },
        {
          sql: `SELECT string_agg(city, ',' ORDER BY id) FROM users WHERE country = 'USA' AND status = 'active'`,
          equals: 'New York,Boston,Newport News,Murray Hill',
        },
        { sql: `SELECT count(*)::text FROM users WHERE country = 'USA' AND status = 'active'`, equals: '4' },
      ],
      reveal: {
        correct: `SELECT id, city FROM users WHERE country = 'USA' AND status = 'active' ORDER BY id;`,
        why:
          'The two predicates *describe* the set — active AND in the USA — and that is all the ' +
          'query needs to say; the engine works out how to find those four rows (ids 2, 5, 7, 10). ' +
          'The `ORDER BY id` is the one place you stepped in to *ask* for a sequence: without it ' +
          'the four rows are the same set but in no promised order, so pinning the output would be ' +
          'unsafe. You could equally have written the membership test as a subquery or reordered ' +
          'the two ANDs — same description, same set, same result. Describe what you want; state ' +
          'the order you need; leave the how to the engine.',
        reproduceSql:
          `SELECT id, city FROM users WHERE country = 'USA' AND status = 'active' ORDER BY id;`,
      },
    },
  ],
};
