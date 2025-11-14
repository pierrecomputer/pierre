'use client';

import { DocsHeader } from '../docs/DocsHeader';
import { BigBoiDiff } from './BigBoiDiff';

export default function BigBoiPage() {
  return (
    <>
      <div className="relative mx-auto w-5xl max-w-full px-5">
        <DocsHeader />
      </div>
      <div>
        <BigBoiDiff />
      </div>
    </>
  );
}
