/**
 * The lesson registry: every authored Lesson, and a unit → Lesson map derived from it.
 *
 * Authoring a lesson (4.3/4.4) is one import + one array entry here; the map, the nav's
 * built-state, the route's static params, and "first built lesson" all derive from this array,
 * so a unit id is typed in exactly one place.
 */

import type { Lesson } from './types';
import { designAccessPatterns } from './lessons/design-access-patterns';
import { designEntities } from './lessons/design-entities';
import { designRelationships } from './lessons/design-relationships';
import { tier0RelationalModel } from './lessons/tier0-relational-model';
import { tier0EvalOrder } from './lessons/tier0-eval-order';
import { tier0Declarative } from './lessons/tier0-declarative';
import { tier0Null } from './lessons/tier0-null';
import { tier0DataTypes } from './lessons/tier0-data-types';
import { tier1Select } from './lessons/tier1-select';
import { tier1Where } from './lessons/tier1-where';
import { tier1OrderLimit } from './lessons/tier1-order-limit';
import { tier1Aggregation } from './lessons/tier1-aggregation';
import { tier1Joins } from './lessons/tier1-joins';
import { tier1SetOps } from './lessons/tier1-set-ops';

/** All authored lessons. Order here doesn't matter — the curriculum outline owns ordering. */
export const lessons: readonly Lesson[] = [
  designAccessPatterns,
  designEntities,
  designRelationships,
  tier0RelationalModel,
  tier0EvalOrder,
  tier0Declarative,
  tier0Null,
  tier0DataTypes,
  tier1Select,
  tier1Where,
  tier1OrderLimit,
  tier1Aggregation,
  tier1Joins,
  tier1SetOps,
];

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
