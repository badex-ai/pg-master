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

// Per the PostgreSQL 18 EXPLAIN synopsis, options are EITHER the parenthesized,
// comma-separated form `EXPLAIN ( option [, ...] ) statement`, OR the legacy form
// `EXPLAIN [ ANALYZE ] [ VERBOSE ] statement` — and the legacy form allows ONLY those
// two keywords, in that exact order. We match exactly that; anything else Postgres
// itself rejects, and we leave such SQL untouched so the real error surfaces.
const EXPLAIN_RE = /^\s*EXPLAIN\s+(\(([^)]*)\)|((?:ANALYZE\s+)?(?:VERBOSE\s+)?))/i;

/** True if the trimmed SQL is an EXPLAIN statement. */
export function isExplain(sql: string): boolean {
  return /^\s*EXPLAIN\b/i.test(sql);
}

/**
 * Rewrite an EXPLAIN so it returns FORMAT JSON while keeping the learner's other
 * options (ANALYZE, BUFFERS, …). Handles the three EXPLAIN spellings:
 *   EXPLAIN <q>                    → EXPLAIN (FORMAT JSON) <q>
 *   EXPLAIN ANALYZE <q>            → EXPLAIN (ANALYZE, FORMAT JSON) <q>
 *   EXPLAIN (ANALYZE, …) <q>       → EXPLAIN (ANALYZE, …, FORMAT JSON) <q>
 * If FORMAT is already specified, the query is returned unchanged (we won't fight it).
 */
export function toJsonExplain(sql: string): string {
  const m = sql.match(EXPLAIN_RE);
  if (!m) return sql;
  const paren = m[2]; // contents of (...) form, if any
  const legacy = m[3]; // ANALYZE/VERBOSE/… keyword form, if any
  const rest = sql.slice(m[0].length);

  if (paren !== undefined) {
    if (/\bFORMAT\b/i.test(paren)) return sql; // caller chose a format; leave it
    const opts = paren.trim() ? `${paren.trim()}, FORMAT JSON` : 'FORMAT JSON';
    return `EXPLAIN (${opts})${rest.startsWith(' ') ? '' : ' '}${rest}`;
  }

  const legacyOpts = (legacy ?? '').trim().replace(/\s+/g, ', ');
  const opts = legacyOpts ? `${legacyOpts}, FORMAT JSON` : 'FORMAT JSON';
  return `EXPLAIN (${opts}) ${rest.trim()}`;
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
