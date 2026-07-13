'use client';

import { useSyncExternalStore } from 'react';
import { subscribe, getCompleted } from './progress';

/**
 * The set of completed unit ids, reactive across the whole app (nav tick, home count, quiz).
 *
 * Kept out of `progress.ts` so that module stays React-free and transpiles standalone for tests.
 * `getCompleted` returns a stable snapshot (replaced only on change), so `useSyncExternalStore`
 * won't loop. The empty server snapshot means SSR/first paint shows nothing complete, then the
 * client re-syncs from localStorage on hydration.
 */
export function useCompletedUnits(): readonly string[] {
  return useSyncExternalStore(subscribe, getCompleted, () => EMPTY);
}

const EMPTY: readonly string[] = [];
