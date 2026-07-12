/**
 * Unit tests for the EXPLAIN → FORMAT JSON rewriter and plan extractor.
 *
 * These guard the two subtle pieces that only ever had manual (in-browser) proof:
 *   1. Distinguishing an EXPLAIN *option list* `EXPLAIN (ANALYZE) <q>` from a
 *      parenthesized *statement* `EXPLAIN (SELECT 1)` — the latter must be left
 *      untouched, or we'd inject `FORMAT JSON` into a place Postgres rejects.
 *   2. `positionDelta` — how far the statement body shifts right when we prepend
 *      `(FORMAT JSON)`, so a Postgres error caret can be mapped back onto the SQL
 *      the learner actually typed. Off-by-one here points the caret at the wrong token.
 *
 * explain.ts is pure TypeScript (no runtime imports), but this Node (v20) predates
 * native type-stripping, so we transpile the single file with the project's own tsc
 * to a temp .js and import that. Zero new deps; still `node --test`.
 *
 * Run: node --test src/lib/explain.test.mjs
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

let mod; // the transpiled explain module
let outDir;

before(() => {
  outDir = mkdtempSync(join(tmpdir(), 'explain-test-'));
  // Transpile just src/lib/explain.ts with the project's tsc. It has no imports, so
  // it compiles to a standalone ESM file we can import directly.
  execFileSync(
    join(ROOT, 'node_modules', '.bin', 'tsc'),
    [
      join(ROOT, 'src', 'lib', 'explain.ts'),
      '--outDir', outDir,
      '--module', 'esnext',
      '--target', 'es2022',
      '--moduleResolution', 'bundler',
    ],
    { stdio: 'pipe' },
  );
});

process.on('exit', () => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

async function load() {
  if (!mod) mod = await import(pathToFileURL(join(outDir, 'explain.js')).href);
  return mod;
}

// A rewrite's positionDelta must equal the exact prefix growth, so caret math is
// a simple subtraction. Verify it against the literal string lengths every time.
function assertDelta(original, expectedSql) {
  const { toJsonExplain } = mod;
  const out = toJsonExplain(original);
  assert.equal(out.sql, expectedSql, `rewrite of: ${original}`);
  assert.equal(
    out.positionDelta,
    expectedSql.length - original.length,
    `delta must equal length growth for: ${original}`,
  );
}

test('isExplain recognizes EXPLAIN regardless of leading space / case', async () => {
  const { isExplain } = await load();
  assert.equal(isExplain('EXPLAIN SELECT 1'), true);
  assert.equal(isExplain('  explain analyze select 1'), true);
  assert.equal(isExplain('ExPlAiN (VERBOSE) SELECT 1'), true);
  assert.equal(isExplain('EXPLAIN(SELECT 1)'), true); // no space is still EXPLAIN
});

test('isExplain rejects non-EXPLAIN and word-prefix false positives', async () => {
  const { isExplain } = await load();
  assert.equal(isExplain('SELECT 1'), false);
  assert.equal(isExplain('EXPLAINER SELECT 1'), false); // \b guards the keyword
  assert.equal(isExplain('-- EXPLAIN\nSELECT 1'), false); // leading comment, not EXPLAIN
});

test('plain EXPLAIN gets (FORMAT JSON) with correct delta', async () => {
  await load();
  assertDelta('EXPLAIN SELECT 1', 'EXPLAIN (FORMAT JSON) SELECT 1');
  // "EXPLAIN (FORMAT JSON) " is 22 chars vs "EXPLAIN " (8) → +14
  assert.equal(mod.toJsonExplain('EXPLAIN SELECT 1').positionDelta, 14);
});

test('legacy ANALYZE / VERBOSE keywords are folded into the option list', async () => {
  await load();
  assertDelta('EXPLAIN ANALYZE SELECT 1', 'EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1');
  assertDelta(
    'EXPLAIN ANALYZE VERBOSE SELECT 1',
    'EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON) SELECT 1',
  );
});

test('parenthesized option list keeps existing options and appends FORMAT JSON', async () => {
  await load();
  assertDelta(
    'EXPLAIN (ANALYZE, BUFFERS) SELECT 1',
    'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT 1',
  );
});

test('no-space EXPLAIN(...) option form is handled', async () => {
  await load();
  // The leading `(` is an option list (ANALYZE), so it is rewritten.
  assertDelta('EXPLAIN(ANALYZE) SELECT 1', 'EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1');
});

test('a parenthesized STATEMENT is left untouched (not mistaken for options)', async () => {
  const { toJsonExplain } = await load();
  // `(SELECT 1)` is a valid parenthesized statement, not an option list. Injecting
  // FORMAT JSON here would corrupt it; it must pass through unchanged, zero delta.
  const out = toJsonExplain('EXPLAIN (SELECT 1)');
  assert.equal(out.sql, 'EXPLAIN (SELECT 1)');
  assert.equal(out.positionDelta, 0);
});

test('an explicit FORMAT is respected — we do not fight the learner', async () => {
  const { toJsonExplain } = await load();
  for (const sql of ['EXPLAIN (FORMAT TEXT) SELECT 1', 'EXPLAIN (ANALYZE, FORMAT YAML) SELECT 1']) {
    const out = toJsonExplain(sql);
    assert.equal(out.sql, sql, `must leave explicit FORMAT untouched: ${sql}`);
    assert.equal(out.positionDelta, 0);
  }
});

test('non-EXPLAIN SQL passes through unchanged', async () => {
  const { toJsonExplain } = await load();
  const out = toJsonExplain('SELECT * FROM users');
  assert.equal(out.sql, 'SELECT * FROM users');
  assert.equal(out.positionDelta, 0);
});

test('positionDelta maps an error caret back onto the original SQL', async () => {
  const { toJsonExplain } = await load();
  // `EXPLAIN SELECT * FROM nope` → the executed text has `nope` shifted right by delta.
  const original = 'EXPLAIN SELECT * FROM nope';
  const { sql: executed, positionDelta } = toJsonExplain(original);
  const posInExecuted = executed.indexOf('nope') + 1; // Postgres positions are 1-based
  const posInOriginal = posInExecuted - positionDelta;
  // The mapped-back position must point at `nope` in what the learner typed.
  assert.equal(original.slice(posInOriginal - 1, posInOriginal - 1 + 4), 'nope');
});

test('parseExplainResult unwraps the QUERY PLAN column shape', async () => {
  const { parseExplainResult } = await load();
  const plan = { Plan: { 'Node Type': 'Seq Scan' } };
  // Postgres returns the plan wrapped in a single-element array under "QUERY PLAN".
  assert.deepEqual(parseExplainResult([{ 'QUERY PLAN': [plan] }]), plan);
  // Also tolerate an already-unwrapped object.
  assert.deepEqual(parseExplainResult([{ 'QUERY PLAN': plan }]), plan);
});

test('parseExplainResult returns null on a non-plan shape', async () => {
  const { parseExplainResult } = await load();
  assert.equal(parseExplainResult([]), null);
  assert.equal(parseExplainResult([{ 'QUERY PLAN': 'Result (cost=...)' }]), null); // text EXPLAIN
  assert.equal(parseExplainResult([{ other: 1 }]), null);
});
