import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { readSettingsCookies } from './_components/readSettingsCookies';
import { TreesDevSettingsProvider } from './_components/TreesDevSettingsProvider';
import { TreesDevSidebar } from './_components/TreesDevSidebar';

export default async function TreesDevLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (process.env.NODE_ENV !== 'development') {
    return notFound();
  }

  const { flattenEmptyDirectories, useLazyDataLoader } =
    await readSettingsCookies();

  return (
    <TreesDevSettingsProvider
      initialFlattenEmptyDirectories={flattenEmptyDirectories}
      initialUseLazyDataLoader={useLazyDataLoader}
    >
      <div className="flex min-h-screen">
        <div className="hidden w-[220px] shrink-0 md:block">
          <TreesDevSidebar />
        </div>
        <main className="min-w-0 flex-1 p-4 pb-[800px]">{children}</main>
      </div>
    </TreesDevSettingsProvider>
  );
}
