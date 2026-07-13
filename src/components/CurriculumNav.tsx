'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CURRICULUM, unitToSlug, type TierOutline } from '@/lib/content/curriculum';
import { isBuilt } from '@/lib/content/index';

/**
 * The curriculum sidebar: the full tier/unit path, design track first. Built units link to their
 * lesson; unbuilt units show as muted "soon" so the whole path is visible without dead links.
 *
 * Lives in the root layout (outside the DB provider), so it renders instantly and never remounts
 * on navigation — collapse state survives. Every link is next/link: a hard <a> navigation would
 * reboot the in-browser Postgres (~4s) and wipe the learner's scratch state.
 */
export function CurriculumNav() {
  const pathname = usePathname();
  const activeSlug = pathname.startsWith('/lesson/') ? pathname.slice('/lesson/'.length) : null;

  return (
    <nav className="w-64 shrink-0 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-4 text-sm">
      <Link href="/" className="mb-4 block text-lg font-bold tracking-tight text-neutral-900">
        PG Master
      </Link>
      <div className="flex flex-col gap-3">
        {CURRICULUM.map((tier) => (
          <TierSection key={String(tier.tier)} tier={tier} activeSlug={activeSlug} />
        ))}
      </div>
    </nav>
  );
}

function TierSection({ tier, activeSlug }: { tier: TierOutline; activeSlug: string | null }) {
  // A tier starts expanded if it contains the active lesson; otherwise collapsed.
  const containsActive = tier.units.some((u) => unitToSlug(u.unit) === activeSlug);
  const [open, setOpen] = useState(containsActive);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-800"
      >
        <span className="inline-block w-3 text-neutral-400">{open ? '▾' : '▸'}</span>
        {tier.label}
      </button>
      {open && (
        <ul className="ml-4 flex flex-col gap-0.5">
          {tier.units.map((u) => {
            const built = isBuilt(u.unit);
            const slug = unitToSlug(u.unit);
            const active = slug === activeSlug;
            if (!built) {
              return (
                <li key={u.unit} className="flex items-center justify-between gap-2 py-0.5 text-neutral-400">
                  <span>{u.title}</span>
                  <span className="rounded bg-neutral-200 px-1 text-[0.65rem] uppercase text-neutral-500">soon</span>
                </li>
              );
            }
            return (
              <li key={u.unit}>
                <Link
                  href={`/lesson/${slug}`}
                  className={`block rounded px-2 py-0.5 ${
                    active ? 'bg-neutral-800 text-white' : 'text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  {u.title}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
