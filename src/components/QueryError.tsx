'use client';

import { caretLine, type PgError } from '@/lib/pgError';

type QueryErrorProps = {
  error: PgError;
  /** The query that produced the error, for the position caret. */
  query: string;
};

/**
 * Renders a Postgres error the way psql does — SQLSTATE, message, optional detail/hint,
 * and a caret under the offending token when the error carries a position. Seeing the
 * real error (not a crash) is itself part of learning SQL.
 */
export function QueryError({ error, query }: QueryErrorProps) {
  const caret = caretLine(query, error.position);
  const line = error.position ? query.slice(0, error.position - 1).split('\n').length : null;

  return (
    <div
      role="alert"
      className="overflow-x-auto rounded border border-red-300 bg-red-50 p-3 font-mono text-sm text-red-800"
    >
      <div className="font-semibold">
        {error.severity ?? 'ERROR'}: {error.message}
      </div>

      {caret !== null && (
        <pre className="mt-1 whitespace-pre text-red-500">
          {`LINE ${line}: ${query.split('\n')[(line ?? 1) - 1]}\n${' '.repeat(`LINE ${line}: `.length)}${caret}`}
        </pre>
      )}

      <dl className="mt-1 space-y-0.5 text-red-700">
        {error.detail && (
          <div className="flex gap-2">
            <dt className="font-semibold">DETAIL:</dt>
            <dd>{error.detail}</dd>
          </div>
        )}
        {error.hint && (
          <div className="flex gap-2">
            <dt className="font-semibold">HINT:</dt>
            <dd>{error.hint}</dd>
          </div>
        )}
        {error.code && (
          <div className="flex gap-2">
            <dt className="font-semibold">SQLSTATE:</dt>
            <dd>{error.code}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
