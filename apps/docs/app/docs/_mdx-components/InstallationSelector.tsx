'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';
import type { PackageManager } from '../Installation/constants';
import { PACKAGE_MANAGERS } from '../Installation/constants';

interface InstallationSelectorProps {
  installationExamples: Record<PackageManager, PreloadedFileResult<undefined>>;
}

export function InstallationSelector({
  installationExamples,
}: InstallationSelectorProps) {
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
      <DocsCodeExample {...installationExamples[selectedPm]} />
    </>
  );
}
