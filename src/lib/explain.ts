/**
 * Helpers for turning an EXPLAIN into a renderable plan tree.
 *
 * Postgres' text EXPLAIN is an indented string; `EXPLAIN (FORMAT JSON)` returns a
 * structured tree we can render properly. So when the learner runs an EXPLAIN we
 * transparently re-run it with FORMAT JSON added (preserving their ANALYZE/BUFFERS
 * options) and render the parsed plan. The plan itself is identical — only the
 * serialization changes.
 */

/** A single node in a Postgres JSON plan (only the fields we render are typed). */
export type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Alias'?: string;
  'Index Name'?: string;
  'Join Type'?: string;
  'Startup Cost'?: number;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Plan Width'?: number;
  'Actual Startup Time'?: number;
  'Actual Total Time'?: number;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Filter'?: string;
  'Index Cond'?: string;
  'Hash Cond'?: string;
  'Recheck Cond'?: string;
  'Sort Key'?: string[];
  'Plans'?: PlanNode[];
  [key: string]: unknown;
};

/** The top-level shape of an `EXPLAIN (FORMAT JSON)` result row's QUERY PLAN column. */
export type ExplainPlan = { Plan: PlanNode; [key: string]: unknown };

// The documented EXPLAIN option keywords (PostgreSQL 18 synopsis). A parenthesized
// group after EXPLAIN is an option list ONLY if it starts with one of these — otherwise
// `EXPLAIN (SELECT 1)` (a valid parenthesized *statement*) would be mis-parsed as options.
const OPTION_KEYWORDS =
  /^\s*(ANALYZE|VERBOSE|COSTS|SETTINGS|GENERIC_PLAN|BUFFERS|SERIALIZE|WAL|TIMING|SUMMARY|MEMORY|FORMAT)\b/i;

// Options are EITHER the parenthesized comma-separated form `EXPLAIN ( option [, ...] )
// statement`, OR the legacy form `EXPLAIN [ ANALYZE ] [ VERBOSE ] statement` — legacy
// allows ONLY those two keywords, in that order (PG18 Compatibility note). `\s*` before
// the paren also accepts the no-space `EXPLAIN(...)` spelling Postgres permits.
const EXPLAIN_RE = /^\s*EXPLAIN\s*(\(([^)]*)\)|(\s(?:ANALYZE\s+)?(?:VERBOSE\s+)?))/i;

/** A rewritten EXPLAIN plus how far the statement text shifted, so error carets can realign. */
export type RewrittenExplain = { sql: string; positionDelta: number };

/** True if the trimmed SQL is an EXPLAIN statement. */
export function isExplain(sql: string): boolean {
  return /^\s*EXPLAIN\b/i.test(sql);
}

/**
 * Rewrite an EXPLAIN so it returns FORMAT JSON while keeping the learner's other options
 * (ANALYZE, VERBOSE, …). Returns the rewritten SQL and `positionDelta` — the number of
 * characters the statement body shifted right, so a Postgres error position (which points
 * into the rewritten text) can be mapped back onto the SQL the learner actually typed.
 *
 *   EXPLAIN <q>                → EXPLAIN (FORMAT JSON) <q>
 *   EXPLAIN ANALYZE <q>        → EXPLAIN (ANALYZE, FORMAT JSON) <q>
 *   EXPLAIN (ANALYZE, …) <q>   → EXPLAIN (ANALYZE, …, FORMAT JSON) <q>
 *
 * If FORMAT is already specified, or the input isn't the recognized shape (e.g. a
 * parenthesized *statement*, or a comment before the options), the SQL is returned
 * unchanged with a zero delta — Postgres then runs it verbatim and any real error surfaces.
 */
export function toJsonExplain(sql: string): RewrittenExplain {
  const m = sql.match(EXPLAIN_RE);
  if (!m) return { sql, positionDelta: 0 };
  const paren = m[2]; // contents of (...) form, if any
  const legacy = m[3]; // leading-space + ANALYZE/VERBOSE keyword form, if any

  if (paren !== undefined) {
    // Only a real option list, not a parenthesized statement like `(SELECT 1)`.
    if (!OPTION_KEYWORDS.test(paren)) return { sql, positionDelta: 0 };
    if (/\bFORMAT\b/i.test(paren)) return { sql, positionDelta: 0 }; // caller chose a format
    const rest = sql.slice(m[0].length);
    const head = `EXPLAIN (${paren.trim()}, FORMAT JSON)`;
    const gap = rest.startsWith(' ') ? '' : ' ';
    const rewritten = `${head}${gap}${rest}`;
    return { sql: rewritten, positionDelta: rewritten.length - sql.length };
  }

  // Legacy / no-options form. Preserve the exact statement body (don't trim it, so the
  // delta stays a simple prefix-length difference).
  const rest = sql.slice(m[0].length);
  const legacyOpts = (legacy ?? '').trim().replace(/\s+/g, ', ');
  const head = legacyOpts ? `EXPLAIN (${legacyOpts}, FORMAT JSON)` : 'EXPLAIN (FORMAT JSON)';
  const rewritten = `${head} ${rest}`;
  return { sql: rewritten, positionDelta: rewritten.length - sql.length };
}

/** Pull the plan out of an `EXPLAIN (FORMAT JSON)` result row, or null if the shape is off. */
export function parseExplainResult(rows: Record<string, unknown>[]): ExplainPlan | null {
  const raw = rows[0]?.['QUERY PLAN'];
  const plan = Array.isArray(raw) ? raw[0] : raw;
  if (plan && typeof plan === 'object' && 'Plan' in plan) {
    return plan as ExplainPlan;
  }
  return null;
}
