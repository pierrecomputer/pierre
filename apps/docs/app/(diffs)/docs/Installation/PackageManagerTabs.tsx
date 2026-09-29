'use client';

import { useState } from 'react';

import { PACKAGE_MANAGERS, type PackageManager } from './constants';
import { DocsCodeExample } from '@/components/docs/DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedCodeExample } from '@/lib/preloadCodeExample';

interface PackageManagerTabsProps {
  installationExamples: Record<
    PackageManager,
    PreloadedCodeExample<undefined, undefined>
  >;
}

export function PackageManagerTabs({
  installationExamples,
}: PackageManagerTabsProps) {
  const [selectedPm, setSelectedPm] = useState<PackageManager>('pnpm');

  return (
    <>
      <ButtonGroup
        value={selectedPm}
        onValueChange={(v) => setSelectedPm(v as PackageManager)}
      >
        {PACKAGE_MANAGERS.map((pm) => (
          <ButtonGroupItem key={pm} value={pm}>
            {pm}
          </ButtonGroupItem>
        ))}
      </ButtonGroup>
      <DocsCodeExample {...installationExamples[selectedPm]} key={selectedPm} />
    </>
  );
}
