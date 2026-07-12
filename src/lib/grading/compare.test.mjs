/**
 * Unit tests for the write-query result comparator.
 *
 * These pin the value-canonicalization edge cases that a naive JSON.stringify gets wrong —
 * verified against real PGlite return types: numeric scale noise (avg), int8 number-vs-bigint,
 * float NaN, money strings, jsonb key order — plus the set/multiset/order semantics.
 *
 * compare.ts has no runtime imports, so we transpile it standalone with the project's tsc
 * (same pattern as explain.test.mjs). Zero new deps.
 *
 * Run: node --test src/lib/grading/compare.test.mjs
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

let compareResults;
let outDir;

before(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'compare-test-'));
  execFileSync(
    join(ROOT, 'node_modules', '.bin', 'tsc'),
    [
      join(ROOT, 'src', 'lib', 'grading', 'compare.ts'),
      '--outDir', outDir,
      '--module', 'esnext',
      '--target', 'es2022',
      '--moduleResolution', 'bundler',
      '--strict',
    ],
    { stdio: 'pipe' },
  );
  ({ compareResults } = await import(pathToFileURL(join(outDir, 'compare.js')).href));
});

process.on('exit', () => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

// Helpers to build ResultLike quickly.
const F = (...names) => names.map((name) => ({ name, dataTypeID: 25 })); // text OID
const num = (name) => ({ name, dataTypeID: 1700 }); // numeric OID
const rows = (fields, ...tuples) => ({
  fields,
  rows: tuples.map((t) => Object.fromEntries(fields.map((f, i) => [f.name, t[i]]))),
});

test('identical unordered sets are equal regardless of row order', () => {
  const ref = rows(F('id'), [1], [2], [3]);
  const learn = rows(F('id'), [3], [1], [2]);
  assert.deepEqual(compareResults(ref, learn), { equal: true });
});

test('orderMatters distinguishes right-rows-wrong-order', () => {
  const ref = rows(F('id'), [1], [2], [3]);
  const learn = rows(F('id'), [3], [2], [1]);
  assert.equal(compareResults(ref, learn).equal, true, 'unordered: equal');
  const ordered = compareResults(ref, learn, { orderMatters: true });
  assert.equal(ordered.equal, false);
  assert.equal(ordered.reason, 'row-order');
});

test('numeric scale noise is normalized: 59.50 == 59.5 == avg tail', () => {
  const ref = rows([num('amount')], ['59.5']);
  const learn = rows([num('amount')], ['59.50']);
  assert.deepEqual(compareResults(ref, learn), { equal: true });
  const avgTail = rows([num('amount')], ['59.5000000000000000']);
  assert.deepEqual(compareResults(ref, avgTail), { equal: true });
  // 59.00 canonicalizes to 59, distinct from 59.5 (the DATASET price trap stays sharp).
  const distinct = rows([num('amount')], ['59.00']);
  assert.equal(compareResults(ref, distinct).equal, false);
});

test('numeric family is value-equal across representations (59.00 numeric == 59 int)', () => {
  const refNumeric = rows([{ name: 'v', dataTypeID: 1700 }], ['59.00']);
  const learnInt = rows([{ name: 'v', dataTypeID: 23 }], [59]);
  assert.deepEqual(compareResults(refNumeric, learnInt), { equal: true });
});

test('NaN is not equal to NULL', () => {
  const f = [{ name: 'v', dataTypeID: 701 }]; // float8
  const nan = rows(f, [NaN]);
  const nul = rows(f, [null]);
  assert.equal(compareResults(nan, nul).equal, false);
  assert.deepEqual(compareResults(nan, rows(f, [NaN])), { equal: true });
});

test('bigint does not throw and compares by value with number', () => {
  const f = [{ name: 'v', dataTypeID: 20 }]; // int8
  const big = rows(f, [9007199254740993n]);
  assert.deepEqual(compareResults(big, rows(f, [9007199254740993n])), { equal: true });
  // A safe-range int8 comes back as number; 5 (number) != 9e15 (bigint).
  assert.equal(compareResults(big, rows(f, [5])).equal, false);
});

test('money strings normalize ($59.50 == 59.5)', () => {
  const f = [{ name: 'price', dataTypeID: 790 }]; // money
  assert.deepEqual(compareResults(rows(f, ['$59.50']), rows(f, ['59.5'])), { equal: true });
});

test('text NULL string is distinct from real NULL', () => {
  const f = F('name');
  assert.equal(compareResults(rows(f, ['NULL']), rows(f, [null])).equal, false);
});

test('jsonb compares regardless of key order', () => {
  const f = [{ name: 'j', dataTypeID: 3802 }]; // jsonb
  const a = rows(f, [{ a: 1, b: 2 }]);
  const b = rows(f, [{ b: 2, a: 1 }]);
  assert.deepEqual(compareResults(a, b), { equal: true });
});

test('duplicates matter (multiset, not set)', () => {
  const ref = rows(F('id'), [1], [1], [2]);
  const learn = rows(F('id'), [1], [2], [2]);
  const r = compareResults(ref, learn);
  assert.equal(r.equal, false);
  assert.equal(r.reason, 'rows');
});

test('column name/count mismatch is reported as columns', () => {
  const mismatchCount = compareResults(rows(F('a', 'b'), ['x', 'y']), rows(F('a'), ['x']));
  assert.equal(mismatchCount.reason, 'columns');
  const mismatchName = compareResults(rows(F('email'), ['x']), rows(F('mail'), ['x']));
  assert.equal(mismatchName.reason, 'columns');
  // ignoreColumnNames relaxes names (not count/position).
  assert.equal(
    compareResults(rows(F('email'), ['x']), rows(F('mail'), ['x']), { ignoreColumnNames: true }).equal,
    true,
  );
});

test('rows diff reports missing and extra samples with totals', () => {
  const ref = rows(F('id'), [1], [2], [3], [4]);
  const learn = rows(F('id'), [1], [2], [99]);
  const r = compareResults(ref, learn);
  assert.equal(r.reason, 'rows');
  assert.equal(r.expectedCount, 4);
  assert.equal(r.actualCount, 3);
  assert.equal(r.missingTotal, 2); // 3 and 4 missing
  assert.equal(r.extraTotal, 1); // 99 extra
  assert.equal(r.missing.length, 2);
  assert.equal(r.extra.length, 1);
});

test('empty result sets are equal', () => {
  assert.deepEqual(compareResults(rows(F('id')), rows(F('id'))), { equal: true });
});
