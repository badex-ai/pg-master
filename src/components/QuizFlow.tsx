'use client';

import { useState } from 'react';
import type { Question, Reveal, ExpectedResult } from '@/lib/content/types';
import { TeachContent } from './TeachContent';
import { QueryConsole } from './QueryConsole';

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

export function QuizFlow({ questions }: { questions: Question[] }) {
  const [state, setState] = useState<Record<string, QuestionState>>({});

  const setQ = (id: string, next: QuestionState) => setState((s) => ({ ...s, [id]: next }));

  if (questions.length === 0) return null;

  return (
    <section className="flex flex-col gap-4" aria-label="Questions">
      <h2 className="text-sm font-semibold text-neutral-600">Questions</h2>
      {questions.map((q, i) => (
        <QuestionCard
          key={q.id}
          index={i + 1}
          question={q}
          state={state[q.id] ?? { status: 'unanswered' }}
          onChange={(next) => setQ(q.id, next)}
        />
      ))}
    </section>
  );
}

function QuestionCard({
  index,
  question,
  state,
  onChange,
}: {
  index: number;
  question: Question;
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

      <QuestionBody question={question} state={state} onChange={onChange} />

      {state.status === 'revealed' && <RevealPanel reveal={question.reveal} />}
    </div>
  );
}

/** The kind-specific answer UI. */
function QuestionBody({
  question,
  state,
  onChange,
}: {
  question: Question;
  state: QuestionState;
  onChange: (next: QuestionState) => void;
}) {
  const revealed = state.status === 'revealed';

  switch (question.kind) {
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

    case 'write-query': {
      // Run freely in the console; "Show answer" reveals the reference. No grading here (3.4).
      return (
        <div className="flex flex-col gap-2">
          <QueryConsole initialSql="" />
          {!revealed && (
            <button
              type="button"
              onClick={() => onChange({ status: 'revealed' })}
              className="self-start rounded border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Show answer
            </button>
          )}
          {revealed && (
            <pre className="overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-3 font-mono text-sm text-neutral-800">
              <code>{question.referenceSql}</code>
            </pre>
          )}
        </div>
      );
    }

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
