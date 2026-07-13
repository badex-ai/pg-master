/**
 * Validates the content model (task 3.1): the types compile and the sample lesson conforms.
 *
 * The lesson modules are TypeScript importing the shared types via the `@/` alias. This Node
 * (v20) can't strip types, so we transpile the types + sample together with the project's own
 * tsc, using a generated tsconfig that resolves `@/` — the same zero-dep approach as
 * explain.test.mjs. `import type` is erased, so the emitted sample loads standalone.
 *
 * The real type-safety gate is the project-wide `npx tsc --noEmit`; this test proves the sample
 * is well-formed at runtime (every question has a known kind, a reveal, and its kind-specific
 * required fields).
 *
 * Run: node --test src/lib/content/content.test.mjs
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..'); // repo root
const require = createRequire(import.meta.url);

let outDir;
let lesson; // the transpiled sample

// The 11 taxonomy kinds (CURRICULUM.md). The union in types.ts must stay in lockstep with this.
const KINDS = new Set([
  'predict-output',
  'predict-error',
  'spot-the-bug',
  'write-query',
  'rewrite-optimize',
  'read-plan',
  'choose-index',
  'concurrency',
  'explain-mechanism',
  'compare-approaches',
  'multiple-choice',
]);

before(() => {
  outDir = mkdtempSync(join(tmpdir(), 'content-test-'));
  const cfg = join(outDir, 'tsconfig.json');
  const c = (...p) => join(ROOT, 'src', 'lib', 'content', ...p);
  writeFileSync(
    cfg,
    JSON.stringify({
      compilerOptions: {
        outDir,
        rootDir: join(ROOT, 'src'),
        // CommonJS so `require` resolves the registry's extensionless relative imports
        // (index.ts → ./lessons/tier1-select); ESM output would need rewritten specifiers.
        module: 'commonjs',
        target: 'es2022',
        moduleResolution: 'node',
        esModuleInterop: true,
        strict: true,
        baseUrl: ROOT,
        paths: { '@/*': ['./src/*'] },
        skipLibCheck: true,
      },
      // The registry (index.ts) pulls in types + the sample lesson transitively; curriculum is
      // standalone. Compiling these proves the whole content layer type-checks together.
      files: [c('types.ts'), c('lessons', 'tier1-select.ts'), c('curriculum.ts'), c('index.ts')],
    }),
  );
  // Fails the test if the sample doesn't type-check against the model.
  execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['--project', cfg], { stdio: 'pipe' });
});

process.on('exit', () => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

async function load() {
  if (!lesson) {
    ({ tier1Select: lesson } = require(join(outDir, 'lib', 'content', 'lessons', 'tier1-select.js')));
  }
  return lesson;
}

const mod = async (name) => require(join(outDir, 'lib', 'content', `${name}.js`));

test('the sample lesson has the required top-level shape', async () => {
  const l = await load();
  assert.equal(l.id, 'tier1.select');
  assert.equal(l.unit, '1.1');
  assert.equal(l.tier, 1);
  assert.ok(l.title && typeof l.title === 'string');
  assert.ok(l.teach.includes('SELECT'), 'teach content present');
  assert.ok(Array.isArray(l.questions) && l.questions.length >= 1);
});

test('every question has a known kind and a complete reveal', async () => {
  const l = await load();
  for (const q of l.questions) {
    assert.ok(KINDS.has(q.kind), `unknown question kind: ${q.kind}`);
    assert.ok(q.id && q.prompt, `question ${q.id} needs id + prompt`);
    assert.ok(q.reveal && q.reveal.correct && q.reveal.why, `question ${q.id} needs a reveal (correct + why)`);
  }
});

test('kind-specific required fields are present', async () => {
  const l = await load();
  const byId = Object.fromEntries(l.questions.map((q) => [q.id, q]));

  // write-query must carry the grading oracle.
  const wq = byId['q1'];
  assert.equal(wq.kind, 'write-query');
  assert.match(wq.referenceSql, /select/i, 'write-query needs referenceSql');

  // multiple-choice must have choices and an in-range answer index.
  const mc = byId['q2'];
  assert.equal(mc.kind, 'multiple-choice');
  assert.ok(Array.isArray(mc.choices) && mc.choices.length >= 2);
  assert.ok(mc.answerIndex >= 0 && mc.answerIndex < mc.choices.length, 'answerIndex in range');
  // The trap answer is 9 (COUNT skips the one NULL full_name), not 10.
  assert.equal(mc.choices[mc.answerIndex], '9');
});

test('every write-query reference is a non-mutating SELECT (grading invariant)', async () => {
  const l = await load();
  // The grader runs referenceSql FIRST as the oracle on pristine state, then the learner's SQL
  // against the same state. A mutating reference would break that "same state" guarantee, and a
  // reference with no result columns can't be compared. Enforce both at authoring time.
  const mutating = /\b(insert|update|delete|drop|alter|create|truncate)\b/i;
  for (const q of l.questions.filter((q) => q.kind === 'write-query')) {
    assert.match(q.referenceSql, /select/i, `${q.id}: referenceSql must SELECT`);
    assert.doesNotMatch(q.referenceSql, mutating, `${q.id}: referenceSql must not mutate`);
  }
});

test('curriculum outline has no duplicate units', async () => {
  const { ALL_UNITS } = await mod('curriculum');
  assert.equal(new Set(ALL_UNITS).size, ALL_UNITS.length, 'duplicate unit id in the outline');
});

test('every unit id round-trips through the slug encoding', async () => {
  // The nav/route encode unit → slug (dots → dashes) and back. If any unit id ever contains a
  // dash, that round-trip breaks and produces a dead link — assert it never does, for every unit.
  const { ALL_UNITS, unitToSlug, slugToUnit } = await mod('curriculum');
  for (const u of ALL_UNITS) {
    assert.equal(slugToUnit(unitToSlug(u)), u, `slug round-trip broken for "${u}"`);
  }
});

test('every authored lesson maps to a real outline unit, tier-consistent', async () => {
  const { lessons } = await mod('index');
  const { CURRICULUM } = await mod('curriculum');
  const tierByUnit = new Map();
  for (const t of CURRICULUM) for (const u of t.units) tierByUnit.set(u.unit, t.tier);
  for (const lesson of lessons) {
    assert.ok(tierByUnit.has(lesson.unit), `lesson unit "${lesson.unit}" is not in the outline`);
    assert.equal(tierByUnit.get(lesson.unit), lesson.tier, `lesson "${lesson.unit}" tier mismatch`);
  }
});
