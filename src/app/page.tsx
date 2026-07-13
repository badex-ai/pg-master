import Link from 'next/link';
import { CURRICULUM, ALL_UNITS, unitToSlug } from '@/lib/content/curriculum';
import { isBuilt } from '@/lib/content/index';
import { ProgressSummary } from '@/components/ProgressSummary';

/** The first built lesson in curriculum order, if any — the landing "Start" target. */
function firstBuiltUnit(): string | null {
  return ALL_UNITS.find(isBuilt) ?? null;
}

export default function Home() {
  const start = firstBuiltUnit();
  const totalUnits = CURRICULUM.reduce((n, t) => n + t.units.length, 0);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-8 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight">PG Master</h1>
        <p className="text-lg text-neutral-500">
          Learn PostgreSQL — from designing a database to querying it at an expert level —
          practicing against real Postgres running in your browser.
        </p>
      </header>

      <p className="text-sm text-neutral-500">
        The path runs design-first, then Tier 0 → 5: {totalUnits} units in all. Pick any unit from
        the sidebar, or start at the beginning.
      </p>

      <ProgressSummary />

      {start ? (
        <Link
          href={`/lesson/${unitToSlug(start)}`}
          className="self-start rounded bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Start learning →
        </Link>
      ) : (
        <p className="text-sm text-neutral-400">Lessons are being authored — check back soon.</p>
      )}
    </main>
  );
}
