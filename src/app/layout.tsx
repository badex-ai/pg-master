import type { Metadata } from 'next';
import './globals.css';
import { DatabaseProvider } from '@/lib/db/provider';
import { CurriculumNav } from '@/components/CurriculumNav';

export const metadata: Metadata = {
  title: 'PG Master — Learn PostgreSQL to Mastery',
  description:
    'Design and query PostgreSQL at an expert level, practicing against real Postgres in your browser.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* Nav sits outside DatabaseProvider so it renders instantly and the "Starting Postgres…"
          splash only fills the content pane, not the whole screen. */}
      <body className="antialiased">
        <div className="flex min-h-screen">
          <CurriculumNav />
          <div className="flex-1 overflow-x-hidden">
            <DatabaseProvider>{children}</DatabaseProvider>
          </div>
        </div>
      </body>
    </html>
  );
}
