import type { ReactNode } from 'react';

import { readSettingsCookies } from './_components/readSettingsCookies';
import { TreesDevSettingsProvider } from './_components/TreesDevSettingsProvider';
import { TreesDevShell } from './_components/TreesDevShell';

export default async function TreesDevLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { flattenEmptyDirectories } = await readSettingsCookies();

  return (
    <TreesDevSettingsProvider
      initialFlattenEmptyDirectories={flattenEmptyDirectories}
    >
      <TreesDevShell>{children}</TreesDevShell>
    </TreesDevSettingsProvider>
  );
}
