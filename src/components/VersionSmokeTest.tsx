'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePGlite } from '@electric-sql/pglite-react';
import { useResetDatabase } from '@/lib/db/provider';

/**
 * Proves the in-browser Postgres is live and seeded: queries the version, shows the
 * seeded user count, and exercises the reset action. A temporary smoke test for
 * tasks 0.3 and 1.3 (the real editor/grid replaces this in Phase 2).
 */
export function VersionSmokeTest() {
  const db = usePGlite();
  const reset = useResetDatabase();
  const [version, setVersion] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshCount = useCallback(async () => {
    const res = await db.query<{ c: number }>('SELECT count(*)::int AS c FROM reviews');
    setReviewCount(res.rows[0]?.c ?? null);
  }, [db]);

  useEffect(() => {
    db.query<{ version: string }>('SELECT version()')
      .then((res) => setVersion(res.rows[0]?.version ?? '(no rows)'))
      .catch((e) => setError(String(e)));
    refreshCount().catch((e) => setError(String(e)));
  }, [db, refreshCount]);

  const handleDeleteAll = useCallback(async () => {
    setBusy(true);
    try {
      await db.exec('DELETE FROM reviews;');
      await refreshCount();
    } finally {
      setBusy(false);
    }
  }, [db, refreshCount]);

  const handleReset = useCallback(async () => {
    setBusy(true);
    try {
      await reset();
      await refreshCount();
    } finally {
      setBusy(false);
    }
  }, [reset, refreshCount]);

  if (error) {
    return <p className="font-mono text-sm text-red-500">Error: {error}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-sm text-emerald-500">
        {version ? version : 'Querying version…'}
      </p>
      <p className="font-mono text-sm text-neutral-500" data-testid="review-count">
        reviews seeded: {reviewCount ?? '…'}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleDeleteAll}
          disabled={busy}
          className="rounded border border-neutral-300 px-3 py-1 text-sm disabled:opacity-50"
        >
          Delete some rows
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={busy}
          className="rounded border border-neutral-300 px-3 py-1 text-sm disabled:opacity-50"
        >
          Reset database
        </button>
      </div>
    </div>
  );
}
