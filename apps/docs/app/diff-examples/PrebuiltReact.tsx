'use client';

import { IconCheck, IconCopyFill } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useState } from 'react';

import { FeatureHeader } from './FeatureHeader';

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
                onClick={() => void copyToClipboard()}
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
        <FeatureHeader
          title="Pre-built React and JavaScript components"
          description="No two codebases are alike, so we give you the freedom to implement Precision Diffs however you like. Components are logically separated—file wrapper, header, hunk, and more—and are all available in React or JavaScript versions."
        />
        <div className="grid md:grid-cols-2 gap-4">
          <CodeBlock code={reactCode} language="React" />
          <CodeBlock code={jsCode} language="JavaScript" />
        </div>
      </div>
    </div>
  );
}
