'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import { IconCheck, IconCopyFill } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { FileContents } from '@pierre/diff-ui';
import { useState } from 'react';

const OLD_FILE: FileContents = {
  name: 'file.tsx',
  contents: `import * as 'react';
import IconSprite from './IconSprite';
import Header from './Header';

export default function Home() {
  return (
    <div>
      <Header />
      <IconSprite />
    </div>
  );
}
`,
};

const NEW_FILE: FileContents = {
  name: 'file.tsx',
  contents: `import IconSprite from './IconSprite';
import HeaderSimple from '../components/HeaderSimple';
import Hero from '../components/Hero';

export default function Home() {
  return (
    <div>
      <HeaderSimple />
      <IconSprite />
      <h1>Hello!</h1>
    </div>
  );
}
`,
};

interface CodeBlockProps {
  code: string;
  language?: string;
}

function CodeBlock({ code, language = 'typescript' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 5000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div className="relative group">
      <div className="rounded-lg border bg-muted/30 dark:bg-muted/50">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {language}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={copyToClipboard}
              >
                {copied ? <IconCheck /> : <IconCopyFill />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{copied ? 'Copied!' : 'Copy code'}</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="p-4">
          <pre className="text-sm font-mono leading-relaxed">
            <code className="text-foreground">{code}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}

export function PrebuiltReact() {
  const reactCode = `import {
  uiFileWrapper,
  uiHiddenLines,
  uiDivider,
  uiHunk
} from @pierre/precision-diffs;`;

  const jsCode = `import {
  uiFileWrapper,
  uiHiddenLines,
  uiDivider,
  uiHunk
} from './@pierrejs/precision-diffs/index.js';`;

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <h3 className="text-2xl font-semibold">
          Pre-built React and JavaScript components
        </h3>
        <p className="text-sm text-muted-foreground">
          No two codebases are alike, so we give you the freedom to implement
          Precision Diffs however you like. Components are logically
          separated—file wrapper, header, hunk, and more—and are all available
          in React or JavaScript versions.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <CodeBlock code={reactCode} language="React" />
          <CodeBlock code={jsCode} language="JavaScript" />
        </div>
      </div>
    </div>
  );
}
