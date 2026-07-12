import { LessonView } from '@/components/LessonView';
import { SampleDataPanel } from '@/components/SampleDataPanel';
import { tier1Select } from '@/lib/content/lessons/tier1-select';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-12">
      <LessonView lesson={tier1Select} />
      <SampleDataPanel />
    </main>
  );
}
