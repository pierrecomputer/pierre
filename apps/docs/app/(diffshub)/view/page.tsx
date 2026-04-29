import type { Metadata } from 'next';

import { ViewHeader } from './_components/ViewHeader';

export const metadata: Metadata = {
  title: 'View',
};

// Placeholder PR until the form on `/` actually wires through to a route
// param or query string. Lifted to a constant so it's obvious this is the
// thing to swap out next.
const PLACEHOLDER_URL = 'https://github.com/linux/linux/pulls/123456';

export default function DiffshubViewPage() {
  return (
    <div className="flex min-h-screen min-w-screen flex-col gap-2 bg-neutral-50 p-2">
      <ViewHeader url={PLACEHOLDER_URL} />
      {/* Sidebar pinned at 240px on desktop, code view fills the rest. On
          mobile we collapse to a single stacked column. */}
      <main className="grid grid-cols-1 gap-2 md:grid-cols-[280px_auto]">
        <div className="p-3">sidebar</div>
        <div className="bg-background border-border rounded-lg border p-16">
          codeview
        </div>
      </main>
    </div>
  );
}
