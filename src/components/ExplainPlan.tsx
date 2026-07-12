'use client';

import type { ExplainPlan, PlanNode } from '@/lib/explain';

/**
 * All conditions on a node, as labeled lines — not just the first. A node commonly carries
 * several at once (e.g. a Bitmap Heap Scan has both `Recheck Cond` and `Filter`), and the
 * index-cond-vs-filter distinction is the whole point of the index lessons, so we show every
 * one. `Filter` also gets its `Rows Removed by Filter` count, the sharpest estimate-vs-actual
 * teaching number under ANALYZE.
 */
function nodeConditions(node: PlanNode): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  if (node['Index Cond'] !== undefined) lines.push({ label: 'Index Cond', value: node['Index Cond'] });
  if (node['Recheck Cond'] !== undefined) lines.push({ label: 'Recheck Cond', value: node['Recheck Cond'] });
  if (node['Hash Cond'] !== undefined) lines.push({ label: 'Hash Cond', value: node['Hash Cond'] });
  if (node['Merge Cond'] !== undefined) lines.push({ label: 'Merge Cond', value: node['Merge Cond'] });
  if (node['Join Filter'] !== undefined) lines.push({ label: 'Join Filter', value: node['Join Filter'] });
  if (node['Filter'] !== undefined) {
    const removed = node['Rows Removed by Filter'];
    const value = removed !== undefined ? `${node['Filter']} (removed ${removed} rows)` : node['Filter'];
    lines.push({ label: 'Filter', value });
  }
  if (node['Sort Key'] !== undefined) lines.push({ label: 'Sort Key', value: node['Sort Key'].join(', ') });
  return lines;
}

/** The relation/index a node reads, for the header line. */
function nodeTarget(node: PlanNode): string | null {
  if (node['Index Name']) {
    return node['Relation Name'] ? `${node['Index Name']} on ${node['Relation Name']}` : node['Index Name'];
  }
  return node['Relation Name'] ?? null;
}

function PlanTreeNode({ node, depth }: { node: PlanNode; depth: number }) {
  const target = nodeTarget(node);
  const conditions = nodeConditions(node);
  // ANALYZE actuals: gate on Actual Rows, not time — `TIMING OFF` drops the time fields
  // but still reports rows/loops (the estimate-vs-actual row drift is the core lesson).
  const hasActuals = node['Actual Rows'] !== undefined;
  const loops = node['Actual Loops'] ?? 1;
  const perLoop = loops > 1; // ANALYZE reports per-loop averages when a node runs many times

  return (
    <li className="ml-0">
      <div
        className="border-l-2 border-neutral-200 py-1 pl-3"
        style={{ marginLeft: depth === 0 ? 0 : '0.25rem' }}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-sm font-semibold text-neutral-800">
            {node['Node Type']}
            {node['Join Type'] ? ` (${node['Join Type']})` : ''}
          </span>
          {target && <span className="font-mono text-sm text-sky-700">on {target}</span>}
        </div>

        <div className="flex flex-wrap gap-x-3 font-mono text-xs text-neutral-500">
          {node['Total Cost'] !== undefined && (
            <span>
              cost={node['Startup Cost']}..{node['Total Cost']}
            </span>
          )}
          {node['Plan Rows'] !== undefined && <span>rows≈{node['Plan Rows']}</span>}
          {hasActuals && (
            <span className="text-emerald-700">
              actual: {node['Actual Rows']} rows{perLoop ? '/loop' : ''}
              {node['Actual Total Time'] !== undefined
                ? ` in ${node['Actual Total Time'].toFixed(3)} ms${perLoop ? '/loop' : ''}`
                : ''}
              {perLoop ? ` × ${loops} loops` : ''}
            </span>
          )}
        </div>

        {conditions.map((c) => (
          <div key={c.label} className="font-mono text-xs text-neutral-400">
            <span className="text-neutral-500">{c.label}:</span> {c.value}
          </div>
        ))}
      </div>

      {node['Plans'] && node['Plans'].length > 0 && (
        <ul className="ml-4">
          {node['Plans'].map((child, i) => (
            <PlanTreeNode key={i} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Renders a Postgres query plan as a readable tree (node type, relation/index, estimated
 * cost/rows, and — under ANALYZE — actual rows and time), instead of the raw indented text.
 * This is what makes the index/performance lessons visible: a Seq Scan vs an Index Scan,
 * and estimate-vs-actual row drift, are right there in the tree.
 */
export function ExplainPlanView({ plan }: { plan: ExplainPlan }) {
  return (
    <div className="overflow-x-auto rounded border border-neutral-300 bg-neutral-50 p-3">
      <ul>
        <PlanTreeNode node={plan.Plan} depth={0} />
      </ul>
    </div>
  );
}
