/**
 * Result-set comparison for write-query grading.
 *
 * Compares a learner's result to the reference's, per the question's CompareMode. The hard part
 * is canonicalizing values: PGlite returns `numeric` as a scale-preserving string (and `avg(...)`
 * with a long tail), `int8` as `number` OR `bigint` depending on magnitude, `float 'NaN'` as JS
 * `NaN`, dates as `Date`, jsonb as objects. A naive JSON.stringify fails three ways — NaN becomes
 * "null" (equal to SQL NULL), bigint throws, and avg's scale noise fails correct answers. So each
 * cell is encoded to a type-tagged pair `[tag, repr]`, using the column's OID to normalize the
 * numeric family exactly (no float round-trip).
 *
 * Zero runtime imports — declares its own structural input type — so it unit-tests standalone.
 */

/** Postgres numeric OIDs (int2, int4, int8, oid, float4, float8, numeric, money). */
const NUMERIC_OIDS = new Set([21, 23, 20, 26, 700, 701, 1700, 790]);

type Field = { name: string; dataTypeID: number };
export type ResultLike = { rows: Record<string, unknown>[]; fields: Field[] };

export type CompareOptions = { orderMatters?: boolean; ignoreColumnNames?: boolean };

export type CompareResult =
  | { equal: true }
  | { equal: false; reason: 'columns'; expected: string[]; actual: string[] }
  | { equal: false; reason: 'row-order' }
  | {
      equal: false;
      reason: 'rows';
      expectedCount: number;
      actualCount: number;
      missing: Record<string, unknown>[]; // in reference, not learner (sample, capped)
      extra: Record<string, unknown>[]; // in learner, not reference (sample, capped)
      missingTotal: number;
      extraTotal: number;
    };

const SAMPLE_CAP = 5;

/**
 * Normalize a numeric string to a canonical exact form WITHOUT a float round-trip:
 * strip a leading sign on zero, leading zeros, and trailing fractional zeros / dangling dot.
 * "59.5000000000000000" → "59.5", "59.00" → "59", "-0" → "0". Unparseable (NaN/Infinity/money
 * leftovers) pass through verbatim.
 */
function canonDecimal(raw: string): string {
  let s = raw.trim();
  if (!/^[+-]?\d*\.?\d+$/.test(s)) return s; // not a plain decimal — leave as-is
  let sign = '';
  if (s[0] === '+' || s[0] === '-') {
    sign = s[0] === '-' ? '-' : '';
    s = s.slice(1);
  }
  if (s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, ''); // trailing fractional zeros, then dangling dot
  }
  s = s.replace(/^0+(?=\d)/, ''); // leading zeros, keep one digit
  if (s === '' || s === '0') return '0'; // normalize -0 → 0
  return sign + s;
}

/** Encode one cell to a type-tagged pair; `oid` guides numeric-family handling. */
function cell(value: unknown, oid: number): [string, string?] {
  if (value === null || value === undefined) return ['z'];
  if (typeof value === 'bigint') return ['n', value.toString()]; // before any stringify
  if (typeof value === 'number') return Number.isNaN(value) ? ['n', 'NaN'] : ['n', canonDecimal(String(value))];
  if (typeof value === 'boolean') return ['b', value ? 't' : 'f'];
  if (value instanceof Date) return ['d', String(value.getTime())];
  if (value instanceof Uint8Array) {
    return ['x', Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('')];
  }
  if (typeof value === 'string') {
    if (NUMERIC_OIDS.has(oid)) {
      const stripped = value.replace(/[$,]/g, ''); // money: "$59.50" → "59.50"
      return ['n', canonDecimal(stripped)];
    }
    return ['s', value];
  }
  if (Array.isArray(value)) return ['a', JSON.stringify(value.map((v) => cell(v, oid)))];
  if (typeof value === 'object') return ['j', stableStringify(value)];
  return ['s', String(value)];
}

/** JSON with recursively sorted object keys, so jsonb `{a,b}` equals `{b,a}`. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** Canonical key for a whole row: the ordered list of its cell tags. */
function rowKey(row: Record<string, unknown>, fields: Field[]): string {
  return JSON.stringify(fields.map((f) => cell(row[f.name], f.dataTypeID)));
}

/**
 * Compare the learner's result to the reference's. `reference` is the oracle (its column names
 * and order define "correct" unless ignoreColumnNames).
 */
export function compareResults(
  reference: ResultLike,
  learner: ResultLike,
  opts: CompareOptions = {},
): CompareResult {
  const refCols = reference.fields.map((f) => f.name);
  const learnCols = learner.fields.map((f) => f.name);

  // Column count always matters; names must match positionally unless relaxed.
  if (refCols.length !== learnCols.length) {
    return { equal: false, reason: 'columns', expected: refCols, actual: learnCols };
  }
  if (!opts.ignoreColumnNames && refCols.some((c, i) => c !== learnCols[i])) {
    return { equal: false, reason: 'columns', expected: refCols, actual: learnCols };
  }

  // Compare cells positionally: use the reference's field list for both, but read each row by
  // its own column names. When ignoreColumnNames, align by position via the learner's fields.
  const refKeys = reference.rows.map((r) => rowKey(r, reference.fields));
  const learnKeys = learner.rows.map((r) => rowKey(r, learner.fields));

  if (opts.orderMatters) {
    const sameLength = refKeys.length === learnKeys.length;
    const sameOrder = sameLength && refKeys.every((k, i) => k === learnKeys[i]);
    if (sameOrder) return { equal: true };
    // If the multiset matches but order differs, that's the specific "wrong order" lesson.
    if (multisetEqual(refKeys, learnKeys)) return { equal: false, reason: 'row-order' };
    return rowsDiff(reference, learner, refKeys, learnKeys);
  }

  if (multisetEqual(refKeys, learnKeys)) return { equal: true };
  return rowsDiff(reference, learner, refKeys, learnKeys);
}

function multisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const k of a) counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const k of b) {
    const n = counts.get(k);
    if (n === undefined) return false;
    if (n === 1) counts.delete(k);
    else counts.set(k, n - 1);
  }
  return counts.size === 0;
}

/** Build the missing/extra sample diff from the two keyed row lists. */
function rowsDiff(
  reference: ResultLike,
  learner: ResultLike,
  refKeys: string[],
  learnKeys: string[],
): CompareResult {
  const learnCounts = new Map<string, number>();
  for (const k of learnKeys) learnCounts.set(k, (learnCounts.get(k) ?? 0) + 1);

  // missing = reference rows the learner didn't produce (decrement learner counts as consumed).
  const missing: Record<string, unknown>[] = [];
  let missingTotal = 0;
  for (let i = 0; i < refKeys.length; i++) {
    const k = refKeys[i];
    const have = learnCounts.get(k) ?? 0;
    if (have > 0) learnCounts.set(k, have - 1);
    else {
      missingTotal++;
      if (missing.length < SAMPLE_CAP) missing.push(reference.rows[i]);
    }
  }

  // extra = learner rows not accounted for by the reference (recompute from scratch).
  const refCounts = new Map<string, number>();
  for (const k of refKeys) refCounts.set(k, (refCounts.get(k) ?? 0) + 1);
  const extra: Record<string, unknown>[] = [];
  let extraTotal = 0;
  for (let i = 0; i < learnKeys.length; i++) {
    const k = learnKeys[i];
    const have = refCounts.get(k) ?? 0;
    if (have > 0) refCounts.set(k, have - 1);
    else {
      extraTotal++;
      if (extra.length < SAMPLE_CAP) extra.push(learner.rows[i]);
    }
  }

  return {
    equal: false,
    reason: 'rows',
    expectedCount: reference.rows.length,
    actualCount: learner.rows.length,
    missing,
    extra,
    missingTotal,
    extraTotal,
  };
}
