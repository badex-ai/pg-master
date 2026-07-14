/**
 * Lesson-completion progress, persisted in localStorage.
 *
 * A unit is "complete" once the learner has revealed every question in its quiz (see QuizFlow) —
 * that signal is owned by component state, which dies on navigation, so completion is recorded
 * here, outside React, and read back by the nav (tick), the home page (count), and the quiz.
 *
 * Design: a single `Set<unitId>` behind a plain external store. React reads it via
 * `useSyncExternalStore` (SSR-safe, tears-free). Same-tab writes notify local subscribers
 * synchronously; other tabs are picked up via the window `storage` event. No dependency — the
 * store core (everything above the hook) is React-free so it transpiles standalone for tests.
 */

const STORAGE_KEY = 'pgmaster:completed:v1';

/** In-memory mirror of the persisted set. `null` until first load (lazy, so SSR imports are inert). */
let completed: Set<string> | null = null;

/** Same-tab subscribers. Cross-tab changes arrive via the `storage` event (wired on first load). */
const listeners = new Set<() => void>();

/** A frozen snapshot handed to React; replaced (not mutated) on every change so identity tracks. */
let snapshot: readonly string[] = [];

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    // Accessing localStorage can throw (sandboxed iframe, disabled cookies).
    return false;
  }
}

/** Parse the persisted array, tolerating absence and any malformed/legacy value. */
function readStorage(): Set<string> {
  if (!hasStorage()) return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((u): u is string => typeof u === 'string'));
  } catch {
    return new Set();
  }
}

/** Ensure the in-memory set is loaded; wire cross-tab sync exactly once. */
function ensureLoaded(): Set<string> {
  if (completed === null) {
    completed = readStorage();
    snapshot = [...completed];
    if (hasStorage()) {
      window.addEventListener('storage', (e) => {
        // Only react to our key (or a full clear, where `key` is null).
        if (e.key !== null && e.key !== STORAGE_KEY) return;
        completed = readStorage();
        snapshot = [...completed];
        for (const l of listeners) l();
      });
    }
  }
  return completed;
}

function persist(set: Set<string>): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Quota or unavailable — keep the in-memory state; persistence is best-effort.
  }
}

/** Mark a unit complete. Idempotent — a no-op (no notify) if already recorded. */
export function markComplete(unit: string): void {
  const set = ensureLoaded();
  if (set.has(unit)) return;
  set.add(unit);
  persist(set);
  snapshot = [...set];
  for (const l of listeners) l();
}

/** Whether a unit is recorded complete. */
export function isComplete(unit: string): boolean {
  return ensureLoaded().has(unit);
}

/** All completed unit ids (unordered). */
export function getCompleted(): readonly string[] {
  ensureLoaded();
  return snapshot;
}

/** Subscribe to any change; returns an unsubscribe. */
export function subscribe(listener: () => void): () => void {
  ensureLoaded();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Test-only: reset in-memory state so a fresh localStorage stub is re-read. Not used by the app.
 * @internal
 */
export function __resetForTests(): void {
  completed = null;
  snapshot = [];
  listeners.clear();
}
