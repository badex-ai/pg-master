/**
 * Unit tests for the localStorage-backed progress store (the React-free core of progress.ts).
 *
 * These pin the behaviours the UI relies on: idempotent marking, persistence round-trip through
 * a localStorage stub, tolerance of absent/malformed stored values, same-tab subscriber notify,
 * and the empty server snapshot. The hook (useProgress.ts) is not tested here — it's a thin
 * useSyncExternalStore over these functions.
 *
 * progress.ts imports no runtime deps, so we transpile it standalone with the project tsc (same
 * pattern as compare.test.mjs / explain.test.mjs). A minimal window+localStorage stub is installed
 * on globalThis before the module loads, since the store reads `window.localStorage` on load.
 *
 * Run: node --test src/lib/progress.test.mjs
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

let mod;
let outDir;
let store; // the localStorage stub's backing map

/** A minimal localStorage + window + addEventListener stub, installed on globalThis. */
function installStub() {
  store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  globalThis.window = {
    localStorage,
    addEventListener: () => {}, // cross-tab sync is not exercised here
  };
  globalThis.localStorage = localStorage;
}

before(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'progress-test-'));
  execFileSync(
    join(ROOT, 'node_modules', '.bin', 'tsc'),
    ['src/lib/progress.ts', '--outDir', outDir, '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler'],
    { cwd: ROOT, stdio: 'pipe' },
  );
  installStub();
  mod = await import(pathToFileURL(join(outDir, 'progress.js')).href);
});

beforeEach(() => {
  // Fresh storage + fresh in-memory state for each test.
  store.clear();
  mod.__resetForTests();
});

test('a fresh store reports nothing complete', () => {
  assert.equal(mod.isComplete('1.1'), false);
  assert.deepEqual([...mod.getCompleted()], []);
});

test('markComplete records a unit and persists it', () => {
  mod.markComplete('1.1');
  assert.equal(mod.isComplete('1.1'), true);
  assert.deepEqual([...mod.getCompleted()], ['1.1']);
  // Persisted as a JSON array under the versioned key.
  const raw = store.get('pgmaster:completed:v1');
  assert.deepEqual(JSON.parse(raw), ['1.1']);
});

test('markComplete is idempotent and does not double-notify', () => {
  let notifications = 0;
  mod.subscribe(() => notifications++);
  mod.markComplete('1.1');
  mod.markComplete('1.1');
  assert.equal(notifications, 1);
  assert.deepEqual([...mod.getCompleted()], ['1.1']);
});

test('subscribers are notified on a new completion', () => {
  let last = null;
  mod.subscribe(() => {
    last = [...mod.getCompleted()];
  });
  mod.markComplete('1.1');
  mod.markComplete('2.3');
  assert.deepEqual(last, ['1.1', '2.3']);
});

test('getCompleted returns a stable snapshot until the next change', () => {
  const a = mod.getCompleted();
  const b = mod.getCompleted();
  assert.equal(a, b, 'identity is stable between reads');
  mod.markComplete('1.1');
  assert.notEqual(mod.getCompleted(), a, 'identity changes after a write');
});

test('state loads from existing storage on first access', () => {
  store.set('pgmaster:completed:v1', JSON.stringify(['1.1', '4.2']));
  mod.__resetForTests();
  assert.equal(mod.isComplete('1.1'), true);
  assert.equal(mod.isComplete('4.2'), true);
  assert.equal(mod.isComplete('9.9'), false);
});

test('malformed stored values are tolerated as empty', () => {
  for (const bad of ['not json', '{}', '42', '"a string"', 'null']) {
    store.set('pgmaster:completed:v1', bad);
    mod.__resetForTests();
    assert.deepEqual([...mod.getCompleted()], [], `bad value ${bad} → empty`);
  }
});

test('non-string entries in a stored array are dropped', () => {
  store.set('pgmaster:completed:v1', JSON.stringify(['1.1', 3, null, '2.2', { x: 1 }]));
  mod.__resetForTests();
  assert.deepEqual([...mod.getCompleted()], ['1.1', '2.2']);
});
