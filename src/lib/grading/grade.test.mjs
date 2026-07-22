/**
 * Integration tests for the grader's verdicts against a REAL grading instance — in particular the
 * duplicate-output-column guard (DEFECT-1). PGlite returns object-shaped rows, so two columns of
 * the same name collapse to one key and silently lose a value (verified: `SELECT a.id, b.id` →
 * fields [id,id] but rows [{id:2}], the 1 is gone). Grading corrupt rows would mis-judge a correct
 * unaliased join, exactly what Tier-1 learners write. The grader must fail closed instead.
 *
 * This drives the actual grade() → getGradingDb() → PGlite path (boots its own WASM + seed), so it
 * proves the guard on the same code the app runs, not a reimplementation. CommonJS transpile so the
 * relative imports (grade → ./compare, instance → ../db/seed) resolve; PGlite loads via the app code.
 * Under classic `node` resolution tsc can't type-resolve PGlite's `contrib/*` subpath exports (the
 * project build uses `bundler` and passes), so the transpile step emits with noEmitOnError:false and
 * cannot use its exit code as a signal. Type errors are caught by gating on the project's own
 * `tsc --noEmit` first — without that gate a real type error here is indistinguishable from the
 * known contrib warning, and the tests would run green against code that doesn't type-check.
 *
 * Run: node --test src/lib/grading/grade.test.mjs   (slow: boots WASM + seeds)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const require = createRequire(import.meta.url);

let outDir;
let grade;

before(() => {
  // Type-check gate. The transpile below runs with noEmitOnError:false and must swallow tsc's
  // exit code (the contrib/* subpath warning is unavoidable under `node` resolution), which would
  // also swallow a genuine type error in grade.ts. The project's own check uses `bundler`
  // resolution, has no such warning, and fails loudly — so run it first and let it be the signal.
  execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['--noEmit'], { cwd: ROOT, stdio: 'pipe' });

  // Emit inside the repo (not the OS tmpdir) so the transpiled instance.js can `require`
  // '@electric-sql/pglite' — CommonJS resolves modules by walking up from the file's own dir.
  outDir = mkdtempSync(join(ROOT, '.grade-test-'));
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
        noEmitOnError: false,
        baseUrl: ROOT,
        paths: { '@/*': ['./src/*'] },
        skipLibCheck: true,
      },
      files: [join(ROOT, 'src', 'lib', 'grading', 'grade.ts')],
    }),
  );
  // Exits non-zero on the contrib type-resolution warning but still emits correct JS. Type errors
  // are already ruled out by the --noEmit gate above, so the exit code carries no signal here.
  try {
    execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['--project', cfg], { stdio: 'pipe' });
  } catch {
    // expected: contrib/* subpath resolution under `node` moduleResolution
  }
  const emitted = join(outDir, 'lib', 'grading', 'grade.js');
  assert.ok(existsSync(emitted), 'tsc did not emit grade.js');
  ({ grade } = require(emitted));
});

after(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

test('a correct answer grades correct', async () => {
  const res = await grade({
    referenceSql: 'SELECT id FROM users WHERE status = \'active\' ORDER BY id',
    learnerSql: 'SELECT id FROM users WHERE status = \'active\' ORDER BY id',
    compare: { orderMatters: true },
  });
  assert.equal(res.verdict, 'correct');
});

test('a wrong answer grades incorrect with a diff', async () => {
  const res = await grade({
    referenceSql: 'SELECT id FROM users WHERE status = \'active\'',
    learnerSql: 'SELECT id FROM users WHERE status = \'banned\'',
  });
  assert.equal(res.verdict, 'incorrect');
  assert.equal(res.diff.reason, 'rows');
});

test('a learner answer with duplicate output columns is flagged, not mis-graded', async () => {
  // Unaliased self/other join → two `id` columns. Object-rows collapse one; grade must not judge.
  const res = await grade({
    referenceSql: 'SELECT u.id AS user_id, o.id AS order_id FROM users u JOIN orders o ON o.user_id = u.id',
    learnerSql: 'SELECT u.id, o.id FROM users u JOIN orders o ON o.user_id = u.id',
  });
  assert.equal(res.verdict, 'ambiguous-columns');
  assert.equal(res.duplicate, 'id');
});

test('a reference with duplicate output columns is a content bug (unavailable)', async () => {
  const res = await grade({
    referenceSql: 'SELECT u.id, o.id FROM users u JOIN orders o ON o.user_id = u.id',
    learnerSql: 'SELECT 1',
  });
  assert.equal(res.verdict, 'unavailable');
  assert.match(res.message, /named "id"/);
});

test('a learner SQL error grades as error, not incorrect', async () => {
  const res = await grade({
    referenceSql: 'SELECT id FROM users',
    learnerSql: 'SELECT nonexistent_col FROM users',
  });
  assert.equal(res.verdict, 'error');
});

// --- DML grading (probes) ---
// These drive the double-reseed path: reference mutation → probes (oracle), reseed, learner
// mutation → probes, compare. The reseed between the two is the load-bearing part — without it the
// learner would mutate state the reference had already changed.

const CANCEL_PROBES = [
  { label: 'the cancelled order', sql: "SELECT id, status FROM orders WHERE id = 104" },
  { label: 'the other orders', sql: 'SELECT count(*)::text AS c FROM orders WHERE status = \'paid\'' },
];

test('an equivalent mutation grades correct even when spelled differently', async () => {
  // Same effect, different SQL: the learner's statement text is irrelevant, only resulting state.
  const res = await grade({
    referenceSql: "UPDATE orders SET status = 'cancelled' WHERE id = 104",
    learnerSql: "UPDATE orders SET status = 'cancelled' WHERE id = (SELECT min(id) FROM orders WHERE status = 'paid')",
    probes: CANCEL_PROBES,
  });
  assert.equal(res.verdict, 'correct');
});

test('a mutation that does nothing grades incorrect, naming the probe', async () => {
  // The vacuous-pass case the probe design exists to prevent.
  const res = await grade({
    referenceSql: "UPDATE orders SET status = 'cancelled' WHERE id = 104",
    learnerSql: 'SELECT 1',
    probes: CANCEL_PROBES,
  });
  assert.equal(res.verdict, 'incorrect');
  assert.equal(res.probe, 'the cancelled order');
});

test('an over-broad mutation is caught by the second probe', async () => {
  // Updates the target row correctly but also clobbers rows it should not touch. The first probe
  // passes; only the "wrong rows unchanged" probe catches it — the reason probes are a vector.
  const res = await grade({
    referenceSql: "UPDATE orders SET status = 'cancelled' WHERE id = 104",
    learnerSql: "UPDATE orders SET status = 'cancelled' WHERE status = 'paid'",
    probes: CANCEL_PROBES,
  });
  assert.equal(res.verdict, 'incorrect');
  assert.equal(res.probe, 'the other orders');
});

test('the learner mutation starts from pristine state, not the reference-mutated state', async () => {
  // Proves the second reseed happens. The reference DELETEs order 110; if the learner ran against
  // the reference's leftover state, this identical DELETE would affect 0 rows and still "match".
  // It only grades correct because the learner got a fresh instance where 110 exists again.
  const res = await grade({
    referenceSql: 'DELETE FROM shipments WHERE order_id = 110',
    learnerSql: 'DELETE FROM shipments WHERE order_id = 110',
    probes: [{ label: 'remaining shipments', sql: 'SELECT id FROM shipments ORDER BY id' }],
  });
  assert.equal(res.verdict, 'correct');
});

test('an INSERT is graded by the row it leaves behind', async () => {
  const res = await grade({
    referenceSql: "INSERT INTO categories (name, parent_id, slug) VALUES ('Monitors', 5, 'monitors')",
    learnerSql: "INSERT INTO categories (slug, name, parent_id) VALUES ('monitors', 'Monitors', 5)",
    probes: [{ label: 'the new category', sql: "SELECT name, parent_id, slug FROM categories WHERE slug = 'monitors'" }],
  });
  assert.equal(res.verdict, 'correct');
});

test('a failing learner mutation grades as error, not incorrect', async () => {
  const res = await grade({
    referenceSql: "UPDATE orders SET status = 'cancelled' WHERE id = 104",
    learnerSql: "UPDATE orders SET status = 'not_a_valid_status' WHERE id = 104",
    probes: CANCEL_PROBES,
  });
  assert.equal(res.verdict, 'error');
});

test('an unclosed transaction in a learner answer does not wedge the shared instance', async () => {
  // PGlite is one embedded session, so a dangling BEGIN survives the grade and would make every
  // LATER grade fail on `DISCARD ALL cannot run inside a transaction block` — a session-wide
  // outage from one learner's answer, not a single mis-grade. The DML lesson actively suggests
  // wrapping risky writes in BEGIN, so this input is expected, not exotic.
  const wedged = await grade({
    referenceSql: "UPDATE users SET status = 'banned' WHERE status = 'inactive'",
    learnerSql: "BEGIN; UPDATE users SET status = 'banned' WHERE status = 'inactive';",
    probes: [{ label: 'banned users', sql: 'SELECT id, status FROM users WHERE id IN (4, 9) ORDER BY id' }],
  });
  assert.equal(wedged.verdict, 'correct');

  // The real assertion: an unrelated, ordinary question still grades afterwards.
  const after = await grade({
    referenceSql: 'SELECT id FROM users ORDER BY id',
    learnerSql: 'SELECT id FROM users ORDER BY id',
    compare: { orderMatters: true },
  });
  assert.equal(after.verdict, 'correct', `instance wedged: ${after.message ?? ''}`);
});

test('a broken reference mutation is a content bug (unavailable)', async () => {
  const res = await grade({
    referenceSql: 'UPDATE orders SET nonexistent_col = 1 WHERE id = 104',
    learnerSql: 'SELECT 1',
    probes: CANCEL_PROBES,
  });
  assert.equal(res.verdict, 'unavailable');
  assert.match(res.message, /Reference mutation failed/);
});
