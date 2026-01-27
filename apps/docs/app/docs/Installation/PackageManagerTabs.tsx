'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';
import { PACKAGE_MANAGERS, type PackageManager } from './constants';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

interface PackageManagerTabsProps {
  installationExamples: Record<PackageManager, PreloadedFileResult<undefined>>;
}

export function PackageManagerTabs({
  installationExamples,
}: PackageManagerTabsProps) {
  const [selectedPm, setSelectedPm] = useState<PackageManager>('npm');

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
