import { useEffect, useRef, useState } from 'react';

import { IconCheck, IconCopy } from '@/components/icons';
import { cn } from '@/lib/utils';

interface CopyButtonProps {
  content: string;
}

export function CopyCodeButton({ content }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>(-1 as unknown as NodeJS.Timeout);
  const copyToClipboard = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(content);
        // oxlint-disable-next-line no-unused-vars
      } catch (_error) {
        const textarea = document.createElement('textarea');
        textarea.style.position = 'absolute';
        textarea.style.opacity = '0';
        textarea.value = content;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      timeoutRef.current = setTimeout(() => setCopied(false), 3000);
    })();
  };
  useEffect(
    () => () => {
      clearTimeout(timeoutRef.current);
    },
    []
  );
  return (
    <div
      onClick={copyToClipboard}
      tabIndex={0}
      className={cn(
        'hover:bg-accent -mr-[10px] cursor-pointer rounded-sm p-2 opacity-60 hover:opacity-100',
        copied ? 'text-emerald-500' : undefined
      )}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </div>
  );
}
