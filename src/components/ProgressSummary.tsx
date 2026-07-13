'use client';

import { ALL_UNITS } from '@/lib/content/curriculum';
import { isBuilt } from '@/lib/content/index';
import { useCompletedUnits } from '@/lib/useProgress';

/**
 * The learner's completion count on the landing page: "N of M lessons complete", where M is the
 * number of built (authored) units. Client-only — it reads localStorage-backed progress — so it
 * renders nothing on the server and appears after hydration. Only completed units that are still
 * built count, so a removed lesson can't inflate the total.
 */
export function ProgressSummary() {
  const completed = useCompletedUnits();
  const built = ALL_UNITS.filter(isBuilt);
  const doneCount = completed.filter(isBuilt).length;

  if (built.length === 0) return null;

  return (
    <p className="text-sm text-neutral-500">
      {doneCount === 0
        ? `${built.length} lesson${built.length === 1 ? '' : 's'} available — none completed yet.`
        : `${doneCount} of ${built.length} lesson${built.length === 1 ? '' : 's'} complete.`}
    </p>
  );
}
