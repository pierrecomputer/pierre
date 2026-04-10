import type { ReactNode } from 'react';

import { readSettingsCookies } from './_components/readSettingsCookies';
import { TreesDevSettingsProvider } from './_components/TreesDevSettingsProvider';
import { TreesDevShell } from './_components/TreesDevShell';

export default async function TreesDevLayout({
  children,
}: {
  children: ReactNode;
}) {
  // if (process.env.NODE_ENV !== 'development') {
  //   return notFound();
  // }

  const { flattenEmptyDirectories, useLazyDataLoader } =
    await readSettingsCookies();

  return (
    <TreesDevSettingsProvider
      initialFlattenEmptyDirectories={flattenEmptyDirectories}
      initialUseLazyDataLoader={useLazyDataLoader}
    >
      <TreesDevShell>{children}</TreesDevShell>
    </TreesDevSettingsProvider>
  );
}
