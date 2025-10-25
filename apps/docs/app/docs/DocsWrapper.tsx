'use client';

import { useState } from 'react';

import { Installation } from './Installation';
import { Overview } from './Overview';
import { ReactAPI } from './ReactAPI';
import { Styling } from './Styling';
import { VanillaAPI } from './VanillaAPI';
import type { DocsExampleTypes } from './types';

export function DocsWrapper() {
  const [exampleTypes, setExampleType] = useState<DocsExampleTypes>('vanilla');

  return (
    <div className="prose dark:prose-invert w-full max-w-full min-w-0">
      <Installation />
      <Overview exampleType={exampleTypes} setExampleType={setExampleType} />
      <ReactAPI />
      <VanillaAPI />
      <Styling />
      {/* <ComponentProps /> */}
      {/* <RendererOptions /> */}
      {/* <EventHandlers /> */}
      {/* <CompleteExample /> */}
      {/* <TypescriptSupport /> */}
    </div>
  );
}
