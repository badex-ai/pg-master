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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..'); // repo root

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
  const types = join(ROOT, 'src', 'lib', 'content', 'types.ts');
  const sample = join(ROOT, 'src', 'lib', 'content', 'lessons', 'tier1-select.ts');
  writeFileSync(
    cfg,
    JSON.stringify({
      compilerOptions: {
        outDir,
        rootDir: join(ROOT, 'src'),
        module: 'esnext',
        target: 'es2022',
        moduleResolution: 'bundler',
        strict: true,
        baseUrl: ROOT,
        paths: { '@/*': ['./src/*'] },
        skipLibCheck: true,
      },
      files: [types, sample],
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
    const url = pathToFileURL(join(outDir, 'lib', 'content', 'lessons', 'tier1-select.js')).href;
    ({ tier1Select: lesson } = await import(url));
  }
  return lesson;
}

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
  // The trap answer is 8 (COUNT skips NULLs), not 10.
  assert.equal(mc.choices[mc.answerIndex], '8');
});
