'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Question, Reveal, ExpectedResult } from '@/lib/content/types';
import { grade, type GradeResult } from '@/lib/grading/grade';
import { prewarmGradingDb } from '@/lib/grading/instance';
import { markComplete } from '@/lib/progress';
import { TeachContent } from './TeachContent';
import { QueryConsole } from './QueryConsole';
import { ResultGrid } from './ResultGrid';
import { QueryError } from './QueryError';

/**
 * The quiz surface for a lesson: each question as a card, answered in place, then a reveal.
 *
 * Scope (per the 3.3/3.4 split): this handles interaction + reveal. Multiple-choice is graded
 * here (a plain index compare). Write-query lets the learner run freely in an embedded console,
 * then "Show answer" reveals the reference — the machine-graded verdict comparing result sets
 * lands in 3.4. Predict-output reveals the authored expected result (self-assessed). Any other
 * kind falls back to prompt + reveal, which is exactly right for `explain-mechanism`.
 *
 * Answer state is owned here (not per-card) so 4.2 can persist per-question results and
 * "quiz complete". A question goes `unanswered → revealed` and the reveal is terminal — no
 * re-answering, since the reveal contains the answer.
 */

type QuestionState = { status: 'unanswered' | 'revealed'; selectedIndex?: number; correct?: boolean };

export function QuizFlow({
  unit,
  questions,
  lessonSetupSql,
}: {
  unit: string;
  questions: Question[];
  lessonSetupSql?: string;
}) {
  const [state, setState] = useState<Record<string, QuestionState>>({});

  const setQ = (id: string, next: QuestionState) => setState((s) => ({ ...s, [id]: next }));

  // The lesson is complete once every question has been revealed (answered or shown). This is the
  // only completion signal; it's recorded in localStorage so the nav tick and count survive reload.
  // An empty quiz is never "complete" (nothing to reveal), so `every` over [] must not count.
  // Reveal is terminal — a question never returns to 'unanswered' — so this only ever goes
  // false→true. A future "retry quiz" affordance would need an unmarkComplete path to stay honest.
  const allRevealed = questions.length > 0 && questions.every((q) => state[q.id]?.status === 'revealed');
  useEffect(() => {
    if (allRevealed) markComplete(unit);
  }, [allRevealed, unit]);

  if (questions.length === 0) return null;

  return (
    <section className="flex flex-col gap-4" aria-label="Questions">
      <h2 className="text-sm font-semibold text-neutral-600">Questions</h2>
      {questions.map((q, i) => (
        <QuestionCard
          key={q.id}
          index={i + 1}
          question={q}
          lessonSetupSql={lessonSetupSql}
          state={state[q.id] ?? { status: 'unanswered' }}
          onChange={(next) => setQ(q.id, next)}
        />
      ))}
      {allRevealed && (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          ✓ Lesson complete — every question answered. Your progress is saved.
        </p>
      )}
    </section>
  );
}

function QuestionCard({
  index,
  question,
  lessonSetupSql,
  state,
  onChange,
}: {
  index: number;
  question: Question;
  lessonSetupSql?: string;
  state: QuestionState;
  onChange: (next: QuestionState) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs text-neutral-400">Q{index}</span>
        <div className="flex-1">
          {/* Prompts are markdown (inline code / fenced sql) — render, don't show raw backticks. */}
          <TeachContent markdown={question.prompt} />
        </div>
      </div>

      <QuestionBody question={question} lessonSetupSql={lessonSetupSql} state={state} onChange={onChange} />

      {state.status === 'revealed' && <RevealPanel reveal={question.reveal} />}
    </div>
  );
}

/** The kind-specific answer UI. */
function QuestionBody({
  question,
  lessonSetupSql,
  state,
  onChange,
}: {
  question: Question;
  lessonSetupSql?: string;
  state: QuestionState;
  onChange: (next: QuestionState) => void;
}) {
  const revealed = state.status === 'revealed';

  switch (question.kind) {
    case 'compare-approaches': {
      // Shares the choice UI: `options` are the choices. When `answerIndex` is set the question is
      // graded exactly like multiple-choice; when it's absent (an "it depends" comparison) the
      // options still render, but there's no correct pick — reveal is reached with a plain button.
      const { options, answerIndex } = question;
      const gradable = answerIndex !== undefined;
      return (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-1.5">
            {options.map((option, i) => {
              const selected = state.selectedIndex === i;
              const isCorrect = i === answerIndex;
              const cls = revealed
                ? gradable && isCorrect
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                  : selected
                    ? gradable
                      ? 'border-red-300 bg-red-50 text-red-800'
                      : 'border-neutral-400 bg-neutral-100 text-neutral-800'
                    : 'border-neutral-200 text-neutral-500'
                : selected
                  ? 'border-neutral-800 bg-neutral-800 text-white'
                  : 'border-neutral-200 hover:bg-neutral-50';
              return (
                <li key={i}>
                  <button
                    type="button"
                    disabled={revealed || !gradable}
                    onClick={() => onChange({ ...state, selectedIndex: i })}
                    className={`w-full rounded border px-3 py-1.5 text-left text-sm ${gradable ? 'cursor-pointer' : 'cursor-default'} ${cls}`}
                  >
                    {option}
                  </button>
                </li>
              );
            })}
          </ul>
          {!revealed && (
            <button
              type="button"
              disabled={gradable && state.selectedIndex === undefined}
              onClick={() =>
                onChange({
                  status: 'revealed',
                  selectedIndex: state.selectedIndex,
                  correct: gradable ? state.selectedIndex === answerIndex : undefined,
                })
              }
              className="self-start rounded bg-neutral-800 px-3 py-1 text-sm font-medium text-white disabled:opacity-40"
            >
              {gradable ? 'Submit' : 'Show answer'}
            </button>
          )}
        </div>
      );
    }

    case 'multiple-choice':
    case 'choose-index': {
      const { choices, answerIndex } = question;
      return (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-1.5">
            {choices.map((choice, i) => {
              const selected = state.selectedIndex === i;
              const isCorrect = i === answerIndex;
              // After reveal: green the correct option, red a wrong pick.
              const cls = revealed
                ? isCorrect
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                  : selected
                    ? 'border-red-300 bg-red-50 text-red-800'
                    : 'border-neutral-200 text-neutral-500'
                : selected
                  ? 'border-neutral-800 bg-neutral-800 text-white'
                  : 'border-neutral-200 hover:bg-neutral-50';
              return (
                <li key={i}>
                  <button
                    type="button"
                    disabled={revealed}
                    onClick={() => onChange({ ...state, selectedIndex: i })}
                    className={`w-full rounded border px-3 py-1.5 text-left font-mono text-sm ${cls}`}
                  >
                    {choice}
                  </button>
                </li>
              );
            })}
          </ul>
          {!revealed && (
            <button
              type="button"
              disabled={state.selectedIndex === undefined}
              onClick={() =>
                onChange({ status: 'revealed', selectedIndex: state.selectedIndex, correct: state.selectedIndex === answerIndex })
              }
              className="self-start rounded bg-neutral-800 px-3 py-1 text-sm font-medium text-white disabled:opacity-40"
            >
              Submit
            </button>
          )}
        </div>
      );
    }

    case 'write-query':
      return (
        <WriteQueryCard
          question={question}
          lessonSetupSql={lessonSetupSql}
          revealed={revealed}
          onOutcome={(correct) => onChange({ status: 'revealed', correct })}
        />
      );

    case 'predict-output': {
      return (
        <div className="flex flex-col gap-2">
          <pre className="overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-3 font-mono text-sm text-neutral-800">
            <code>{question.sql}</code>
          </pre>
          {!revealed ? (
            <button
              type="button"
              onClick={() => onChange({ status: 'revealed' })}
              className="self-start rounded border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Reveal result
            </button>
          ) : (
            <ExpectedTable expected={question.expected} />
          )}
        </div>
      );
    }

    default:
      // Fallback for kinds not yet interactive (and the correct model for explain-mechanism):
      // just reveal. Exhaustiveness is enforced in the grader (3.4), not here.
      return revealed ? null : (
        <button
          type="button"
          onClick={() => onChange({ status: 'revealed' })}
          className="self-start rounded border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Show answer
        </button>
      );
  }
}

/** Narrow to just the write-query variant of Question. */
type WriteQuery = Extract<Question, { kind: 'write-query' }>;

/**
 * The write-query answer card: an editor to compose the answer, graded against the reference on
 * a pristine grading instance. "Check answer" runs the grade; correct → green + reveal; incorrect
 * → a diff and the learner can edit and re-check. "Show answer" gives up and reveals the reference.
 */
function WriteQueryCard({
  question,
  lessonSetupSql,
  revealed,
  onOutcome,
}: {
  question: WriteQuery;
  lessonSetupSql?: string;
  revealed: boolean;
  onOutcome: (correct: boolean | undefined) => void;
}) {
  const [sql, setSql] = useState('');
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);

  // Boot the grading instance while the learner reads/types, so the first check isn't a ~4s wait.
  useEffect(() => prewarmGradingDb(), []);

  const check = useCallback(async () => {
    if (!sql.trim() || grading) return;
    setGrading(true);
    const res = await grade({
      referenceSql: question.referenceSql,
      learnerSql: sql,
      setupSql: question.setupSql ?? lessonSetupSql,
      probes: question.probes,
      compare: question.compare,
    });
    setResult(res);
    setGrading(false);
    if (res.verdict === 'correct') onOutcome(true); // correct is terminal → reveal
  }, [sql, grading, question, lessonSetupSql, onOutcome]);

  return (
    <div className="flex flex-col gap-2">
      <QueryConsole initialSql="" onSqlChange={setSql} />

      <div className="flex items-center gap-2">
        {!revealed && (
          <button
            type="button"
            disabled={!sql.trim() || grading}
            onClick={check}
            className="rounded bg-neutral-800 px-3 py-1 text-sm font-medium text-white disabled:opacity-40"
          >
            {grading ? 'Checking…' : 'Check answer'}
          </button>
        )}
        {!revealed && (
          <button
            type="button"
            onClick={() => onOutcome(undefined)}
            className="rounded border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Show answer
          </button>
        )}
      </div>

      {result && <GradeReport result={result} isMutation={!!question.probes?.length} />}

      {revealed && (
        <pre className="overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-3 font-mono text-sm text-neutral-800">
          <code>{question.referenceSql}</code>
        </pre>
      )}
    </div>
  );
}

/** Render a grade verdict: correct banner, a rows/columns/order diff, or an error. */
function GradeReport({ result, isMutation }: { result: GradeResult; isMutation?: boolean }) {
  if (result.verdict === 'correct') {
    return (
      <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">
        {isMutation
          ? '✓ Correct — the database ended up in the right state.'
          : '✓ Correct — your result matches.'}
      </p>
    );
  }
  if (result.verdict === 'error') {
    return <QueryError error={result.error} query={result.sql} />;
  }
  if (result.verdict === 'unavailable') {
    return <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm text-neutral-500">{result.message}</p>;
  }
  if (result.verdict === 'ambiguous-columns') {
    return (
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900">
        Two output columns are both named <code className="font-mono">{result.duplicate}</code> — give each a
        distinct name with <code className="font-mono">AS</code> so the result is unambiguous.
      </p>
    );
  }

  // incorrect: show the diff. For a mutation, `probe` names which state check caught it, and the
  // rows below are the observed state — not the learner's own statement output.
  const { diff } = result;
  return (
    <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">
        {result.probe
          ? `Not quite — after your statement, ${result.probe} doesn't match.`
          : 'Not quite — your result differs.'}
      </p>
      {diff.reason === 'columns' && (
        <p className="font-mono text-xs text-amber-800">
          Expected columns: {diff.expected.join(', ')} · got: {diff.actual.join(', ')}
        </p>
      )}
      {diff.reason === 'row-order' && (
        <p className="text-amber-800">Right rows, wrong order — check your ORDER BY.</p>
      )}
      {diff.reason === 'rows' && (
        <div className="flex flex-col gap-2">
          <p className="text-amber-800">
            Expected {diff.expectedCount} row{diff.expectedCount === 1 ? '' : 's'}, got {diff.actualCount}.
          </p>
          {diff.missingTotal > 0 && (
            <DiffRows label={`Missing from your result (${diff.missingTotal})`} rows={diff.missing} />
          )}
          {diff.extraTotal > 0 && (
            <DiffRows label={`Shouldn't be in your result (${diff.extraTotal})`} rows={diff.extra} />
          )}
        </div>
      )}
    </div>
  );
}

/** A small grid of sample diff rows (column names inferred from the row objects). */
function DiffRows({ label, rows }: { label: string; rows: Record<string, unknown>[] }) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const fields = columns.map((name) => ({ name, dataTypeID: 0 }));
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-amber-900">{label}</p>
      <ResultGrid result={{ rows, fields }} />
    </div>
  );
}

/** A static grid for a predict-output expected result (its shape differs from ResultGrid's). */
function ExpectedTable({ expected }: { expected: ExpectedResult }) {
  const { columns, rows } = expected;
  if (rows.length === 0) {
    return <p className="font-mono text-sm text-neutral-500">(0 rows)</p>;
  }
  return (
    <div className="overflow-x-auto rounded border border-neutral-200">
      <table className="w-full border-collapse font-mono text-sm">
        {columns && (
          <thead>
            <tr className="bg-neutral-50">
              {columns.map((c) => (
                <th key={c} className="border-b border-neutral-200 px-3 py-1 text-left font-semibold text-neutral-600">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={r % 2 ? 'bg-neutral-50/50' : ''}>
              {row.map((cell, c) => (
                <td key={c} className="border-b border-neutral-100 px-3 py-1 text-neutral-800">
                  {cell === null ? <span className="text-neutral-400">NULL</span> : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The reveal: correct answer, the mechanism, and why each distractor is wrong. */
function RevealPanel({ reveal }: { reveal: Reveal }) {
  return (
    <div className="flex flex-col gap-2 rounded border border-neutral-200 bg-neutral-50 p-3 text-sm">
      <p className="text-neutral-900">
        <span className="font-semibold text-emerald-700">Answer:</span> {reveal.correct}
      </p>
      <p className="text-neutral-700">
        <span className="font-semibold text-neutral-600">Why:</span> {reveal.why}
      </p>
      {reveal.distractors && reveal.distractors.length > 0 && (
        <ul className="ml-4 flex list-disc flex-col gap-0.5 text-neutral-600">
          {reveal.distractors.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
      {reveal.reproduceSql && (
        <pre className="overflow-x-auto rounded border border-neutral-200 bg-white p-2 font-mono text-xs text-neutral-700">
          <code>{reveal.reproduceSql}</code>
        </pre>
      )}
    </div>
  );
}
