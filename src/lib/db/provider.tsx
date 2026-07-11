'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { PGlite } from '@electric-sql/pglite';
import { live, type LiveNamespace } from '@electric-sql/pglite/live';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGliteProvider } from '@electric-sql/pglite-react';
import { resetDatabase, seedDatabase } from './seed';

type PGliteWithLive = PGlite & { live: LiveNamespace };

const ResetContext = createContext<(() => Promise<void>) | null>(null);

/**
 * Re-seed the database to the curated sample, discarding learner edits. Throws if
 * used outside DatabaseProvider (the db must exist to reset it).
 */
export function useResetDatabase(): () => Promise<void> {
  const reset = useContext(ResetContext);
  if (!reset) {
    throw new Error('useResetDatabase must be used within a DatabaseProvider');
  }
  return reset;
}

/**
 * Boots a single in-browser PGlite instance (real Postgres in WASM) and makes it
 * available via the pglite-react context. PGlite is client-only, so this component
 * initializes lazily in the browser, seeds the curated dataset once, and renders
 * children only once the database is ready and seeded.
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<PGliteWithLive | null>(null);

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
      });

    return () => {
      cancelled = true;
      void instance?.close();
    };
  }, []);

  const reset = useCallback(async () => {
    if (db) await resetDatabase(db);
  }, [db]);

  if (!db) {
    return (
      <div className="flex min-h-screen items-center justify-center font-mono text-sm text-neutral-400">
        Starting Postgres in your browser…
      </div>
    );
  }

  return (
    <ResetContext.Provider value={reset}>
      <PGliteProvider db={db}>{children}</PGliteProvider>
    </ResetContext.Provider>
  );
}
