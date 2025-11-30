'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';
import { PACKAGE_MANAGERS, type PackageManager } from './constants';

interface InstallationProps {
  installationExamples: Record<PackageManager, PreloadedFileResult<undefined>>;
}

export function Installation({ installationExamples }: InstallationProps) {
  const [selectedPm, setSelectedPm] = useState<PackageManager>('npm');

  return (
    <section className="space-y-4">
      <h2>Installation</h2>
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
      <h3>Package Exports</h3>
      <p>The package provides several entry points for different use cases:</p>
      <ul>
        <li>
          <code>@pierre/precision-diffs</code> —{' '}
          <a href="#vanilla-js-api">Vanilla JS components</a> and{' '}
          <a href="#utilities">utility functions</a> for parsing and rendering
          diffs
        </li>
        <li>
          <code>@pierre/precision-diffs/react</code> —{' '}
          <a href="#react-api">React components</a> for rendering diffs with
          full interactivity
        </li>
        <li>
          <code>@pierre/precision-diffs/ssr</code> —{' '}
          <a href="#ssr">Server-side rendering utilities</a> for pre-rendering
          diffs with syntax highlighting
        </li>
        <li>
          <code>@pierre/precision-diffs/worker</code> —{' '}
          <a href="#worker-pool">Worker pool utilities</a> for offloading syntax
          highlighting to background threads
        </li>
      </ul>
    </section>
  );
}
