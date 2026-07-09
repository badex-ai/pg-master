import type { Metadata } from 'next';
import './globals.css';

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
      <body className="antialiased">{children}</body>
    </html>
  );
}
