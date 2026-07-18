/**
 * The lesson registry: every authored Lesson, and a unit → Lesson map derived from it.
 *
 * Authoring a lesson (4.3/4.4) is one import + one array entry here; the map, the nav's
 * built-state, the route's static params, and "first built lesson" all derive from this array,
 * so a unit id is typed in exactly one place.
 */

import type { Lesson } from './types';
import { tier1Select } from './lessons/tier1-select';
import { tier1Where } from './lessons/tier1-where';

/** All authored lessons. Order here doesn't matter — the curriculum outline owns ordering. */
export const lessons: readonly Lesson[] = [tier1Select, tier1Where];

/** unit id → Lesson. Throws at module load on a duplicate unit (an authoring mistake). */
export const lessonsByUnit: ReadonlyMap<string, Lesson> = (() => {
  const map = new Map<string, Lesson>();
  for (const lesson of lessons) {
    if (map.has(lesson.unit)) {
      throw new Error(`Duplicate lesson for unit "${lesson.unit}"`);
    }
    map.set(lesson.unit, lesson);
  }
  return map;
})();

/** Whether a unit has an authored lesson. */
export function isBuilt(unit: string): boolean {
  return lessonsByUnit.has(unit);
}
