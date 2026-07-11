'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PGlite } from '@electric-sql/pglite';
import { live, type LiveNamespace } from '@electric-sql/pglite/live';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGliteProvider } from '@electric-sql/pglite-react';
import { resetDatabase, seedDatabase } from './seed';

type PGliteWithLive = PGlite & { live: LiveNamespace };

type ResetContextValue = {
  /** Re-seed the database to the curated sample, discarding learner edits. */
  reset: () => Promise<void>;
  /** Bumped after each reset, so views can invalidate cached results and refetch. */
  resetEpoch: number;
};

const ResetContext = createContext<ResetContextValue | null>(null);

function useResetContext(): ResetContextValue {
  const ctx = useContext(ResetContext);
  if (!ctx) {
    throw new Error('useResetDatabase/useResetEpoch must be used within a DatabaseProvider');
  }
  return ctx;
}

/**
 * Re-seed the database to the curated sample, discarding learner edits. Throws if
 * used outside DatabaseProvider (the db must exist to reset it).
 */
export function useResetDatabase(): () => Promise<void> {
  return useResetContext().reset;
}

/**
 * A counter bumped after each database reset. Views holding query results should key
 * their fetches on this so they refetch the freshly re-seeded data after a reset.
 */
export function useResetEpoch(): number {
  return useResetContext().resetEpoch;
}

/**
 * Boots a single in-browser PGlite instance (real Postgres in WASM) and makes it
 * available via the pglite-react context. PGlite is client-only, so this component
 * initializes lazily in the browser, seeds the curated dataset once, and renders
 * children only once the database is ready and seeded.
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<PGliteWithLive | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [resetEpoch, setResetEpoch] = useState(0);

  useEffect(() => {
    let instance: PGliteWithLive | null = null;
    let cancelled = false;

    PGlite.create({ extensions: { live, citext, btree_gist } })
      .then(async (created) => {
        if (cancelled) {
          void created.close();
          return;
        }
        instance = created as PGliteWithLive;
        await seedDatabase(instance);
        if (cancelled) {
          void instance.close();
          return;
        }
        setDb(instance);
      })
      .catch((e) => {
        if (!cancelled) setInitError(String(e));
      });

    return () => {
      cancelled = true;
      void instance?.close();
    };
  }, []);

  const reset = useCallback(async () => {
    if (!db) return;
    await resetDatabase(db);
    setResetEpoch((n) => n + 1);
  }, [db]);

  const resetValue = useMemo(() => ({ reset, resetEpoch }), [reset, resetEpoch]);

  if (initError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center font-mono text-sm text-red-500">
        <p>Postgres failed to start in your browser.</p>
        <p className="text-neutral-500">{initError}</p>
        <p className="text-neutral-500">Reload the page to try again.</p>
      </div>
    );
  }

  if (!db) {
    return (
      <div className="flex min-h-screen items-center justify-center font-mono text-sm text-neutral-400">
        Starting Postgres in your browser…
      </div>
    );
  }

  return (
    <ResetContext.Provider value={resetValue}>
      <PGliteProvider db={db}>{children}</PGliteProvider>
    </ResetContext.Provider>
  );
}
