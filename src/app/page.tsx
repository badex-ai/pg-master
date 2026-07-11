import { VersionSmokeTest } from '@/components/VersionSmokeTest';
import { EditorSmokeTest } from '@/components/EditorSmokeTest';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">PG Master</h1>
      <p className="text-lg text-neutral-500">
        Learn PostgreSQL — from designing a database to querying it at an expert
        level — practicing against real Postgres running in your browser.
      </p>
      <VersionSmokeTest />
      <EditorSmokeTest />
    </main>
  );
}
