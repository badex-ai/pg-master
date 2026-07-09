'use client';

import { useEffect, useState } from 'react';
import { PGlite } from '@electric-sql/pglite';
import { live, type LiveNamespace } from '@electric-sql/pglite/live';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGliteProvider } from '@electric-sql/pglite-react';

type PGliteWithLive = PGlite & { live: LiveNamespace };

/**
 * Boots a single in-browser PGlite instance (real Postgres in WASM) and makes it
 * available via the pglite-react context. PGlite is client-only, so this component
 * initializes lazily in the browser and renders children once the database is ready.
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<PGliteWithLive | null>(null);

  useEffect(() => {
    let instance: PGliteWithLive | null = null;
    let cancelled = false;

    PGlite.create({ extensions: { live, citext, btree_gist } }).then((created) => {
      if (cancelled) {
        void created.close();
        return;
      }
      instance = created as PGliteWithLive;
      setDb(instance);
    });

    return () => {
      cancelled = true;
      void instance?.close();
    };
  }, []);

  if (!db) {
    return (
      <div className="flex min-h-screen items-center justify-center font-mono text-sm text-neutral-400">
        Starting Postgres in your browser…
      </div>
    );
  }

  return <PGliteProvider db={db}>{children}</PGliteProvider>;
}
