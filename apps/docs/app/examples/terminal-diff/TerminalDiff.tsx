'use client';

import { IconTerminal } from '@/components/icons';
import { FileDiff } from '@pierre/diffs/react';
import type { PreloadFileDiffResult } from '@pierre/diffs/ssr';
import { useEffect, useState } from 'react';

// =============================================================================
// Terminal Header
// =============================================================================

function TerminalHeader() {
  return (
    <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-4 py-2">
      <div className="flex gap-1.5">
        <div className="h-3 w-3 rounded-full bg-red-500" />
        <div className="h-3 w-3 rounded-full bg-yellow-500" />
        <div className="h-3 w-3 rounded-full bg-green-500" />
      </div>
      <div className="ml-2 flex items-center gap-2 text-sm text-neutral-400">
        <IconTerminal size={16} />
        <span>git diff package.json</span>
      </div>
    </div>
  );
}

// =============================================================================
// Typing Command Line
// =============================================================================

function TypingCommandLine({
  command,
  onComplete,
}: {
  command: string;
  onComplete: () => void;
}) {
  const [displayedText, setDisplayedText] = useState('');
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      if (i < command.length) {
        setDisplayedText(command.slice(0, i + 1));
        i++;
      } else {
        clearInterval(interval);
        setTimeout(() => {
          setShowCursor(false);
          onComplete();
        }, 500);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [command, onComplete]);

  return (
    <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-950 px-4 py-3 font-mono text-sm">
      <span className="text-green-400">$</span>
      <span className="text-neutral-200">{displayedText}</span>
      {showCursor && <span className="animate-pulse text-neutral-400">▋</span>}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

interface TerminalDiffProps {
  prerenderedDiff: PreloadFileDiffResult<undefined>;
}

export function TerminalDiff({ prerenderedDiff }: TerminalDiffProps) {
  const [phase, setPhase] = useState<'typing' | 'ready'>('typing');
  const [showOutput, setShowOutput] = useState(false);

  const handleTypingComplete = () => {
    setPhase('ready');
    setTimeout(() => setShowOutput(true), 200);
  };

  const reset = () => {
    setPhase('typing');
    setShowOutput(false);
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <IconTerminal size={20} className="text-green-400" />
          <h2 className="text-2xl font-medium">Terminal Diff</h2>
        </div>
        <p className="text-muted-foreground">
          A terminal-inspired diff view with classic <code>+/-</code> indicators
          and no line numbers. Perfect for embedding in documentation or showing
          git workflows.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl">
        <TerminalHeader />

        {phase === 'typing' && (
          <TypingCommandLine
            command="git diff package.json"
            onComplete={handleTypingComplete}
          />
        )}

        {phase === 'ready' && (
          <div
            className={`transition-opacity duration-500 ${showOutput ? 'opacity-100' : 'opacity-0'}`}
          >
            <FileDiff
              {...prerenderedDiff}
              options={{
                ...prerenderedDiff.options,
                disableFileHeader: true,
                disableLineNumbers: true,
                diffIndicators: 'classic',
              }}
            />

            {/* Command prompt after output */}
            <div className="flex items-center gap-2 border-t border-neutral-800 px-4 py-3 font-mono text-sm">
              <span className="text-green-400">$</span>
              <span className="animate-pulse text-neutral-400">▋</span>
            </div>
          </div>
        )}
      </div>

      {phase === 'ready' && (
        <button
          onClick={reset}
          className="cursor-pointer rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-700"
        >
          Replay Animation
        </button>
      )}
    </div>
  );
}
