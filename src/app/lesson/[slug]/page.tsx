import { notFound } from 'next/navigation';
import { LessonView } from '@/components/LessonView';
import { SampleDataPanel } from '@/components/SampleDataPanel';
import { lessons, lessonsByUnit } from '@/lib/content/index';
import { slugToUnit, unitToSlug } from '@/lib/content/curriculum';

/** Pre-render a route for each authored lesson (built units only). */
export function generateStaticParams() {
  return lessons.map((l) => ({ slug: unitToSlug(l.unit) }));
}

export default async function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lesson = lessonsByUnit.get(slugToUnit(slug));
  if (!lesson) notFound();

  return (
    <div className="flex flex-col gap-8">
      <LessonView lesson={lesson} />
      <SampleDataPanel />
    </div>
  );
}
