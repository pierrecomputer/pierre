import type { FileContents } from '@pierre/precision-diffs';

import { DocsCodeExample } from './DocsCodeExample';

const CODE: FileContents = {
  name: 'complete_example.tsx',
  contents: `import { FileDiff } from '@pierre/precision-diffs';
import type { FileContents, DiffLineAnnotation } from '@pierre/precision-diffs';
import { useState } from 'react';

export default function DiffViewer() {
const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');

const oldFile: FileContents = {
name: 'components/Header.tsx',
contents: \`import React from 'react';
import { Logo } from './Logo';

export function Header() {
return (
<header className="header">
<Logo />
<nav>
<a href="/home">Home</a>
</nav>
</header>
);
}\`
};

const newFile: FileContents = {
name: 'components/Header.tsx',
contents: \`import React from 'react';
import { Logo } from './Logo';
import { Navigation } from './Navigation';

export function Header() {
return (
<header className="header-new">
<Logo size="large" />
<Navigation />
</header>
);
}\`
};

const annotations: DiffLineAnnotation[] = [
{
side: 'additions',
lineNumber: 3,
data: { message: 'New component imported' }
}
];

return (
<div>
<button onClick={() => setDiffStyle('split')}>Split</button>
<button onClick={() => setDiffStyle('unified')}>Unified</button>

<FileDiff
oldFile={oldFile}
newFile={newFile}
annotations={annotations}
className="rounded-lg overflow-hidden border"
options={{
theme: 'pierre-dark',
diffStyle,
diffIndicators: 'bars',
overflow: 'scroll',
onLineClick: (props) => {
console.log('Line clicked:', props.lineNumber);
}
}}
renderAnnotation={(annotation) => (
<div className="annotation">
{annotation.data.message}
</div>
)}
/>
</div>
);
}`,
};

export function CompleteExample() {
  return (
    <section className="space-y-4">
      <h2>Complete Example</h2>
      <p>Here&lsquo;s a more complete example with multiple options:</p>
      <DocsCodeExample file={CODE} />
    </section>
  );
}
