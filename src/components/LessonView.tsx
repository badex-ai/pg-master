'use client';

import type { Lesson } from '@/lib/content/types';
import { TeachContent } from './TeachContent';
import { QueryConsole } from './QueryConsole';
import { QuizFlow } from './QuizFlow';

/**
 * Renders one lesson: its teach content (markdown), then the live editor preloaded with the
 * lesson's worked example so the learner can run it immediately and experiment. The editor is
 * the same QueryConsole used on its own — a lesson just seeds it with `exampleSql`.
 *
 * Quiz questions (3.3) and grading (3.4) are not rendered here yet; this is the teach + practice
 * surface. The tier/unit badge orients the learner within the curriculum.
 */
export function LessonView({ lesson }: { lesson: Lesson }) {
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-xs uppercase tracking-wide text-neutral-400">
          {typeof lesson.tier === 'number' ? `Tier ${lesson.tier}` : 'Design'} · Unit {lesson.unit}
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{lesson.title}</h1>
      </header>

      <TeachContent markdown={lesson.teach} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-600">Try it</h2>
        {/* Preload the worked example; fall back to a bare SELECT if the lesson omits one. */}
        <QueryConsole initialSql={lesson.exampleSql ?? 'SELECT 1;'} />
      </section>

      <QuizFlow questions={lesson.questions} />
    </article>
  );
}
