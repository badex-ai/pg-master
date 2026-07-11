/**
 * Normalizes an error thrown by a PGlite query into the fields psql/pgAdmin show.
 *
 * PGlite throws a DatabaseError, but its class name is minified in the bundle, so we
 * narrow structurally (a `code` SQLSTATE + `message`) rather than by instanceof. Fields
 * mirror a real Postgres error report: message, SQLSTATE code, severity, detail, hint,
 * and `position` — a 1-based character offset into the submitted query.
 */
export type PgError = {
  message: string;
  code?: string;
  severity?: string;
  detail?: string;
  hint?: string;
  /** 1-based character offset into the query the error points at, if any. */
  position?: number;
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Structurally identify a Postgres error (has a SQLSTATE-like `code` and a `message`). */
export function toPgError(err: unknown): PgError {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const message = str(e.message) ?? String(err);
    const positionRaw = str(e.position);
    const position = positionRaw && /^\d+$/.test(positionRaw) ? Number(positionRaw) : undefined;
    return {
      message,
      code: str(e.code),
      severity: str(e.severity),
      detail: str(e.detail),
      hint: str(e.hint),
      position,
    };
  }
  return { message: String(err) };
}

/**
 * Build the "caret line" psql prints under a query to point at the error position:
 * the substring up to the (1-based) position, with non-tab characters turned to
 * spaces so a monospace caret lands under the offending token. Returns null if there
 * is no position or it falls outside the query.
 */
export function caretLine(query: string, position?: number): string | null {
  if (!position || position < 1 || position > query.length + 1) return null;
  // Only meaningful for a single-line pointer; collapse to the last line up to position.
  const upto = query.slice(0, position - 1);
  const lastNewline = upto.lastIndexOf('\n');
  const lineStart = upto.slice(lastNewline + 1);
  const pad = lineStart.replace(/[^\t]/g, ' ');
  return `${pad}^`;
}
