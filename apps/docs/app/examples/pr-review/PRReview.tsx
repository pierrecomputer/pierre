'use client';

import {
  IconCheck,
  IconComment,
  IconInReview,
  IconMergedFill,
} from '@/components/icons';
import { FileDiff } from '@pierre/diffs/react';
import type { PreloadFileDiffResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DIFFS } from './constants';

// =============================================================================
// File Status Badge
// =============================================================================

function StatusBadge({ status }: { status: 'modified' | 'added' | 'deleted' }) {
  const colors = {
    modified: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
    added: 'bg-green-900/50 text-green-300 border-green-700',
    deleted: 'bg-red-900/50 text-red-300 border-red-700',
  };

  return (
    <span
      className={`rounded border px-2 py-0.5 text-xs font-medium uppercase ${colors[status]}`}
    >
      {status}
    </span>
  );
}

// =============================================================================
// Main Component
// =============================================================================

interface PRReviewProps {
  prerenderedDiffs: PreloadFileDiffResult<undefined>[];
}

export function PRReview({ prerenderedDiffs }: PRReviewProps) {
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    new Set(DIFFS.map((d) => d.diff.name))
  );
  const [comments, setComments] = useState<Record<string, string>>({});

  const allApproved =
    DIFFS.length > 0 && DIFFS.every((d) => approvals[d.diff.name]);

  const toggleExpanded = (name: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const toggleApproval = (name: string) => {
    setApprovals((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const totalAdditions = DIFFS.reduce(
    (acc, d) =>
      acc + d.diff.hunks.reduce((h, hunk) => h + hunk.additionLines, 0),
    0
  );
  const totalDeletions = DIFFS.reduce(
    (acc, d) =>
      acc + d.diff.hunks.reduce((h, hunk) => h + hunk.deletionLines, 0),
    0
  );

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <IconInReview size={20} className="text-purple-400" />
          <h2 className="text-2xl font-medium">Pull Request Review</h2>
        </div>
        <p className="text-muted-foreground">
          Build a complete PR review experience with file navigation, approval
          tracking, and inline comments. Collapse files, approve changes, and
          track review progress.
        </p>
      </div>

      {/* PR Header */}
      <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-800 p-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                allApproved ? 'bg-green-900' : 'bg-purple-900'
              }`}
            >
              {allApproved ? (
                <IconMergedFill size={20} className="text-green-400" />
              ) : (
                <IconInReview size={20} className="text-purple-400" />
              )}
            </div>
            <div>
              <h3 className="font-medium text-neutral-200">
                feat: Add error handling to useAuth hook
              </h3>
              <p className="text-sm text-neutral-500">
                #42 opened by{' '}
                <span className="text-neutral-400">@developer</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1 text-green-400">
              +{totalAdditions}
            </span>
            <span className="flex items-center gap-1 text-red-400">
              -{totalDeletions}
            </span>
            <span className="text-neutral-500">
              {DIFFS.length} file{DIFFS.length !== 1 && 's'}
            </span>
          </div>
        </div>

        {/* Files list */}
        <div className="divide-y divide-neutral-800">
          {prerenderedDiffs.map((prerenderedDiff, idx) => {
            const { diff, status } = DIFFS[idx];
            const isExpanded = expandedFiles.has(diff.name);
            const isApproved = approvals[diff.name];
            const comment = comments[diff.name] ?? '';

            return (
              <div key={diff.name} className="bg-neutral-950/50">
                {/* File header */}
                <div className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-neutral-900/50">
                  <button
                    onClick={() => toggleExpanded(diff.name)}
                    className="flex cursor-pointer items-center gap-3 text-left"
                  >
                    <div
                      className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    >
                      ▶
                    </div>
                    <code className="text-sm text-neutral-300">
                      {diff.name}
                    </code>
                    <StatusBadge status={status} />
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-green-400">
                      +{diff.hunks.reduce((a, h) => a + h.additionLines, 0)}
                    </span>
                    <span className="text-sm text-red-400">
                      -{diff.hunks.reduce((a, h) => a + h.deletionLines, 0)}
                    </span>
                    <button
                      onClick={() => toggleApproval(diff.name)}
                      className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors ${
                        isApproved
                          ? 'bg-green-900 text-green-400'
                          : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700'
                      }`}
                      title={isApproved ? 'Approved' : 'Approve file'}
                    >
                      <IconCheck size={16} />
                    </button>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-neutral-800">
                    <FileDiff
                      {...prerenderedDiff}
                      options={{
                        ...prerenderedDiff.options,
                        disableFileHeader: true,
                      }}
                    />

                    {/* Comment box */}
                    <div className="border-t border-neutral-800 p-3">
                      <div className="flex items-start gap-2">
                        <IconComment
                          size={16}
                          className="mt-2 text-neutral-500"
                        />
                        <textarea
                          value={comment}
                          onChange={(e) =>
                            setComments((prev) => ({
                              ...prev,
                              [diff.name]: e.target.value,
                            }))
                          }
                          placeholder="Leave a comment on this file..."
                          className="min-h-[60px] flex-1 resize-none rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer with merge button */}
        <div className="flex items-center justify-between border-t border-neutral-800 bg-neutral-900 p-4">
          <div className="text-sm text-neutral-400">
            {Object.values(approvals).filter(Boolean).length} of {DIFFS.length}{' '}
            files approved
          </div>
          <button
            disabled={!allApproved}
            className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
              allApproved
                ? 'bg-green-600 text-white hover:bg-green-500'
                : 'cursor-not-allowed bg-neutral-800 text-neutral-500'
            }`}
          >
            <IconMergedFill size={16} />
            {allApproved ? 'Ready to Merge' : 'Approve all files to merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
