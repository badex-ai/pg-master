'use client';

import { useEffect, useState } from 'react';
import { usePGlite } from '@electric-sql/pglite-react';

/**
 * Proves the in-browser Postgres is live by querying its version.
 * A temporary smoke test for task 0.3.
 */
export function VersionSmokeTest() {
  const db = usePGlite();
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db.query<{ version: string }>('SELECT version()')
      .then((res) => setVersion(res.rows[0]?.version ?? '(no rows)'))
      .catch((e) => setError(String(e)));
  }, [db]);

  if (error) {
    return <p className="font-mono text-sm text-red-500">Error: {error}</p>;
  }

  return (
    <p className="font-mono text-sm text-emerald-500">
      {version ? version : 'Querying version…'}
    </p>
  );
}
