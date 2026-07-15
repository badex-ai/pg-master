/**
 * Runtime content verification (HIGH-1): every authored question is checked against a REAL,
 * freshly-seeded PGlite — not just its static shape (that's content.test.mjs's job).
 *
 * Why this exists: authored expectations are unchecked claims about the seed. The very first
 * fixture shipped a wrong multiple-choice answer (caught by hand). At ~70 units that doesn't
 * scale, and any seed change silently invalidates every authored expectation. This test points
 * the app's own machinery — executeSql + the result-set comparator — at the content, so an
 * expectation that no longer matches reality fails CI instead of a learner.
 *
 * What it verifies, per authored question kind:
 *  - write-query: the reference SELECT actually runs on the reseeded instance, returns columns,
 *    and has NO duplicate output name (a duplicate collapses a value in object-shaped rows and
 *    corrupts grading — see grade.ts's guard). orderMatters references must contain ORDER BY,
 *    or the oracle is non-deterministic and grades flaky.
 *  - predict-output: the authored `expected` table matches what `sql` actually returns, compared
 *    with the real comparator (order-insensitive; canonicalized values).
 *  - predict-error: `sql` runs (runs:true) or raises the authored sqlState (runs:false).
 *  - choose-index: `sql` runs against the seed (the plan lesson's query is real).
 *
 * It reuses the app's PGlite boot (citext + btree_gist) and seed SQL, and the transpiled
 * executeSql/compare modules — same "grade what runs" path the UI uses. One instance, reseeded
 * per question (~290ms), same isolation model as the grader.
 *
 * Run: node --test src/lib/content/content-runtime.test.mjs   (slower: boots WASM + seeds)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const require = createRequire(import.meta.url);

let outDir;
let db; // one real PGlite, reseeded per question
let executeSql, compareResults, resetDatabase, seedDatabase, lessons;

/**
 * Transpile the runtime slice to CommonJS, so `require` does extensionless resolution of the
 * relative imports (executeSql → ./pgError, seed → ./schema.sql). ESM emit leaves bare `./pgError`
 * specifiers Node's ESM loader rejects — the same reason content.test.mjs uses CommonJS. PGlite is
 * ESM-only, so we still `import()` it dynamically; the app code under test is pure logic + strings.
 */
function transpile() {
  outDir = mkdtempSync(join(tmpdir(), 'content-runtime-'));
  const cfg = join(outDir, 'tsconfig.json');
  writeFileSync(
    cfg,
    JSON.stringify({
      compilerOptions: {
        outDir,
        rootDir: join(ROOT, 'src'),
        module: 'commonjs',
        target: 'es2022',
        moduleResolution: 'node',
        esModuleInterop: true,
        strict: true,
        baseUrl: ROOT,
        paths: { '@/*': ['./src/*'] },
        skipLibCheck: true,
      },
      // The content registry pulls in every authored lesson + the model transitively; executeSql
      // + compare are the grading path; seed provides boot/reseed.
      files: [
        join(ROOT, 'src', 'lib', 'content', 'index.ts'),
        join(ROOT, 'src', 'lib', 'executeSql.ts'),
        join(ROOT, 'src', 'lib', 'grading', 'compare.ts'),
        join(ROOT, 'src', 'lib', 'db', 'seed.ts'),
      ],
    }),
  );
  execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['--project', cfg], { stdio: 'pipe' });
}

const load = (rel) => require(join(outDir, 'lib', rel));

before(async () => {
  transpile();
  ({ executeSql } = load('executeSql.js'));
  ({ compareResults } = load('grading/compare.js'));
  ({ resetDatabase, seedDatabase } = load('db/seed.js'));
  ({ lessons } = load('content/index.js'));

  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  db = await PGlite.create({ extensions: { citext, btree_gist } });
  await seedDatabase(db);
});

after(async () => {
  if (db) await db.close();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

/** Reseed to pristine, then apply the question/lesson setup — mirrors gradeOnce's preamble. */
async function reseed(setupSql) {
  await db.exec('DISCARD ALL');
  await resetDatabase(db);
  if (setupSql && setupSql.trim()) await db.exec(setupSql);
}

/** Adapt an authored row-major `expected` into the comparator's ResultLike, borrowing the live
 *  run's field OIDs/names so numeric canonicalization matches the grader exactly. */
function expectedToResultLike(expected, liveFields) {
  const fields =
    expected.columns?.map((name, i) => ({ name, dataTypeID: liveFields[i]?.dataTypeID ?? 0 })) ??
    liveFields;
  return {
    fields,
    rows: expected.rows.map((r) => Object.fromEntries(fields.map((f, i) => [f.name, r[i]]))),
  };
}

const dupName = (fields) => {
  const seen = new Set();
  for (const f of fields) {
    if (seen.has(f.name)) return f.name;
    seen.add(f.name);
  }
  return null;
};

// Flatten every authored question with its lesson context, so each becomes its own subtest.
function allQuestions() {
  const out = [];
  for (const lesson of lessons) {
    for (const q of lesson.questions) out.push({ lesson, q });
  }
  return out;
}

test('at least one lesson is authored', () => {
  assert.ok(lessons.length >= 1, 'no lessons to verify');
});

test('authored seed facts still hold against the live seed', async () => {
  // The claims in prompts, choices and reveals are the class that already shipped a wrong answer:
  // static tests pin what the author wrote, not whether it is true of the database. Re-derive each
  // declared fact from a live reseed, so a seed change fails here instead of misleading a learner.
  for (const { lesson, q } of allQuestions()) {
    if (!q.verify?.length) continue;
    await reseed(q.setupSql ?? lesson.setupSql);
    for (const [n, fact] of q.verify.entries()) {
      const label = `${lesson.unit}/${q.id} verify[${n}]`;
      const res = await executeSql(db, fact.sql);
      assert.ok(res.ok, `${label}: sql failed: ${res.ok ? '' : res.error.message}`);
      assert.equal(res.result.rows.length, 1, `${label}: must return exactly one row`);
      assert.equal(res.result.fields.length, 1, `${label}: must return exactly one column`);
      const actual = res.result.rows[0][res.result.fields[0].name];
      assert.equal(
        actual === null ? null : String(actual),
        fact.equals,
        `${label}: seed no longer matches the authored claim`,
      );
    }
  }
});

test('write-query references run, return unique-named columns, and are order-deterministic', async () => {
  for (const { lesson, q } of allQuestions()) {
    if (q.kind !== 'write-query') continue;
    const label = `${lesson.unit}/${q.id}`;
    await reseed(q.setupSql ?? lesson.setupSql);
    const res = await executeSql(db, q.referenceSql);
    assert.ok(res.ok, `${label}: reference failed: ${res.ok ? '' : res.error.message}`);
    assert.ok(res.result.fields.length > 0, `${label}: reference returned no columns`);
    assert.equal(dupName(res.result.fields), null, `${label}: reference has a duplicate output column name`);
    if (q.compare?.orderMatters) {
      assert.match(q.referenceSql, /order\s+by/i, `${label}: orderMatters but reference has no ORDER BY (flaky oracle)`);
    }
  }
});

test('predict-output expected tables match the live result', async () => {
  for (const { lesson, q } of allQuestions()) {
    if (q.kind !== 'predict-output') continue;
    const label = `${lesson.unit}/${q.id}`;
    await reseed(lesson.setupSql);
    const res = await executeSql(db, q.sql);
    assert.ok(res.ok, `${label}: sql failed: ${res.ok ? '' : res.error.message}`);
    const expected = expectedToResultLike(q.expected, res.result.fields);
    const cmp = compareResults(expected, res.result, { ignoreColumnNames: !q.expected.columns });
    assert.ok(cmp.equal, `${label}: authored expected does not match live result (${cmp.equal ? '' : cmp.reason})`);
  }
});

test('predict-error sql runs or raises the authored sqlState', async () => {
  for (const { lesson, q } of allQuestions()) {
    if (q.kind !== 'predict-error') continue;
    const label = `${lesson.unit}/${q.id}`;
    await reseed(lesson.setupSql);
    const res = await executeSql(db, q.sql);
    if (q.runs) {
      assert.ok(res.ok, `${label}: authored runs:true but sql errored: ${res.ok ? '' : res.error.message}`);
    } else {
      assert.ok(!res.ok, `${label}: authored runs:false but sql succeeded`);
      if (q.sqlState) {
        assert.equal(res.error.code, q.sqlState, `${label}: sqlState mismatch`);
      }
    }
  }
});

test('choose-index / read-plan queries run against the seed', async () => {
  for (const { lesson, q } of allQuestions()) {
    if (q.kind !== 'choose-index' && q.kind !== 'read-plan') continue;
    const label = `${lesson.unit}/${q.id}`;
    await reseed(lesson.setupSql);
    const res = await executeSql(db, q.sql);
    assert.ok(res.ok, `${label}: query failed: ${res.ok ? '' : res.error.message}`);
  }
});

test('lesson exampleSql runs against the seed', async () => {
  // exampleSql is preloaded into the live editor (LessonView), so a broken one greets the learner
  // with an error on arrival.
  for (const lesson of lessons) {
    if (!lesson.exampleSql?.trim()) continue;
    await reseed(lesson.setupSql);
    const res = await executeSql(db, lesson.exampleSql);
    assert.ok(res.ok, `${lesson.unit}: exampleSql failed: ${res.ok ? '' : res.error.message}`);
  }
});

test('reveal.reproduceSql runs against the seed', async () => {
  // reproduceSql is offered as "paste this to see it yourself" — except for predict-error
  // questions, whose reveal legitimately reproduces the error.
  for (const { lesson, q } of allQuestions()) {
    const sql = q.reveal?.reproduceSql;
    if (!sql?.trim()) continue;
    if (q.kind === 'predict-error' && q.runs === false) continue;
    await reseed(q.setupSql ?? lesson.setupSql);
    const res = await executeSql(db, sql);
    assert.ok(res.ok, `${lesson.unit}/${q.id}: reproduceSql failed: ${res.ok ? '' : res.error.message}`);
  }
});

test('multiple-choice / choose-index answerIndex is in range', () => {
  for (const { lesson, q } of allQuestions()) {
    if (q.kind !== 'multiple-choice' && q.kind !== 'choose-index') continue;
    const label = `${lesson.unit}/${q.id}`;
    assert.ok(Array.isArray(q.choices) && q.choices.length >= 2, `${label}: needs >=2 choices`);
    assert.ok(q.answerIndex >= 0 && q.answerIndex < q.choices.length, `${label}: answerIndex out of range`);
  }
});

test('reveal.distractors, when present, do not exceed the wrong-choice count', () => {
  // distractors is an order-parallel explanation of the wrong choices. It must not claim more
  // wrong answers than the question has — a count mismatch means the author drifted the arrays.
  for (const { lesson, q } of allQuestions()) {
    const distractors = q.reveal?.distractors;
    if (!distractors) continue;
    const choiceCount = Array.isArray(q.choices) ? q.choices.length : undefined;
    if (choiceCount === undefined) continue; // non-choice kinds may still explain distractors freely
    const label = `${lesson.unit}/${q.id}`;
    assert.ok(
      distractors.length <= choiceCount - 1,
      `${label}: ${distractors.length} distractor notes but only ${choiceCount - 1} wrong choices`,
    );
  }
});
