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
