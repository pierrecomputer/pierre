'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';
import { PACKAGE_MANAGERS, type PackageManager } from './constants';

interface InstallationProps {
  installationExamples: Record<PackageManager, PreloadedFileResult<undefined>>;
}

export function Installation({ installationExamples }: InstallationProps) {
  const [selectedPm, setSelectedPm] = useState<PackageManager>('npm');

  return (
    <section className="space-y-4 contain-layout">
      <h2>Installation</h2>
      <p>
        Diffs is{' '}
        <a
          href="https://www.npmjs.com/package/@pierre/diffs"
          target="_blank"
          rel="noopener noreferrer"
        >
          published as an npm package
        </a>
        . Install Diffs with the package manager of your choice:
      </p>
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

      <table>
        <thead>
          <tr>
            <th>Package</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>@pierre/diffs</code>
            </td>
            <td>
              <a href="#vanilla-js-api">Vanilla JS components</a> and{' '}
              <a href="#utilities">utility functions</a> for parsing and
              rendering diffs
            </td>
          </tr>
          <tr>
            <td>
              <code>@pierre/diffs/react</code>
            </td>
            <td>
              <a href="#react-api">React components</a> for rendering diffs with
              full interactivity
            </td>
          </tr>
          <tr>
            <td>
              <code>@pierre/diffs/ssr</code>
            </td>
            <td>
              <a href="#ssr">Server-side rendering utilities</a> for
              pre-rendering diffs with syntax highlighting
            </td>
          </tr>
          <tr>
            <td>
              <code>@pierre/diffs/worker</code>
            </td>
            <td>
              <a href="#worker-pool">Worker pool utilities</a> for offloading
              syntax highlighting to background threads
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
