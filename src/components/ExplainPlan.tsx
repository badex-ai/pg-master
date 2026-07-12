'use client';

import type { ExplainPlan, PlanNode } from '@/lib/explain';

/** The scan/join/etc. condition on a node, whichever applies. */
function nodeCondition(node: PlanNode): string | null {
  return (
    node['Index Cond'] ??
    node['Hash Cond'] ??
    node['Recheck Cond'] ??
    node['Filter'] ??
    (node['Sort Key'] ? node['Sort Key'].join(', ') : null) ??
    null
  );
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
  const condition = nodeCondition(node);
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

        {condition && (
          <div className="font-mono text-xs text-neutral-400">{condition}</div>
        )}
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
