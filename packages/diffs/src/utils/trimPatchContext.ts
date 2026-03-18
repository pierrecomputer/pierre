import { HUNK_HEADER } from '../constants';

interface CurrentHunk {
  additionStart: number;
  deletionStart: number;
  additionCount: number;
  deletionCount: number;
  hunkLines: string[];
  contextLines: string[];
}

type ContextFlushMode = 'before-change' | 'leading' | 'trailing';

/**
 * A utility function to trim out excess context lines from a patch file.  It
 * will maintain line numbers, and properly update the hunk context markers, as
 * well as be able to create new hunks where necessary if there's excessive
 * context between changes
 */
export function trimPatchContext(patch: string, contextSize = 10): string {
  const lines: string[] = [];

  let currentHunk: CurrentHunk | undefined;
  for (const line of patch.split('\n')) {
    const parsedHunkHeader = line.match(HUNK_HEADER);
    // We've come across a new hunk boundary
    if (parsedHunkHeader != null) {
      // If we have an existing hunk, lets close it out
      // before setting up a new one
      if (currentHunk != null) {
        if (currentHunk.hunkLines.length > 0) {
          flushContextLines(currentHunk, contextSize, 'trailing');
          flushHunk(currentHunk, lines);
        }
        currentHunk = undefined;
      }

      const additionStart = parseInt(parsedHunkHeader[3]);
      const deletionStart = parseInt(parsedHunkHeader[1]);
      const additionCount = parseInt(parsedHunkHeader[4] ?? '1');
      const deletionCount = parseInt(parsedHunkHeader[2] ?? '1');

      // If we can't parse valid numbers out of the hunk header
      // lets just skip the hunk altogether
      if (
        isNaN(additionStart) ||
        isNaN(deletionStart) ||
        isNaN(additionCount) ||
        isNaN(deletionCount)
      ) {
        lines.push(line);
      } else {
        currentHunk = {
          additionStart,
          deletionStart,
          additionCount: 0,
          deletionCount: 0,
          hunkLines: [],
          contextLines: [],
        };
      }
      continue;
    }

    // If we don't have a current hunk, then we should just assume this is
    // general metadata
    if (currentHunk == null) {
      lines.push(line);
      continue;
    }

    // If we are dealing with a context line...
    if (line.startsWith(' ')) {
      currentHunk.contextLines.push(line);
    } else if (line !== '') {
      if (
        currentHunk.hunkLines.length > 0 &&
        currentHunk.contextLines.length > contextSize * 2
      ) {
        const omittedContextLineCount =
          currentHunk.contextLines.length - contextSize * 2;
        const nextContextLines = currentHunk.contextLines.slice(-contextSize);
        flushContextLines(currentHunk, contextSize, 'trailing');
        const {
          additionCount: emittedAdditionCount,
          deletionCount: emittedDeletionCount,
        } = currentHunk;
        flushHunk(currentHunk, lines);

        currentHunk = {
          additionStart:
            currentHunk.additionStart +
            emittedAdditionCount +
            omittedContextLineCount,
          deletionStart:
            currentHunk.deletionStart +
            emittedDeletionCount +
            omittedContextLineCount,
          deletionCount: 0,
          additionCount: 0,
          contextLines: nextContextLines,
          hunkLines: [],
        };
      }

      flushContextLines(
        currentHunk,
        contextSize,
        currentHunk.hunkLines.length === 0 ? 'leading' : 'before-change'
      );
      currentHunk.hunkLines.push(line);
      if (line.startsWith('+')) {
        currentHunk.additionCount += 1;
      } else if (line.startsWith('-')) {
        currentHunk.deletionCount += 1;
      }
    }
  }

  if (currentHunk != null && currentHunk.hunkLines.length > 0) {
    flushContextLines(currentHunk, contextSize, 'trailing');
    flushHunk(currentHunk, lines);
  }

  const result = lines.join('\n');
  return patch.endsWith('\n') ? `${result}\n` : result;
}

function flushContextLines(
  hunk: CurrentHunk,
  contextSize: number,
  mode: ContextFlushMode
) {
  if (mode === 'leading' && hunk.contextLines.length > contextSize) {
    const difference = hunk.contextLines.length - contextSize;
    hunk.contextLines.splice(0, difference);
    hunk.additionStart += difference;
    hunk.deletionStart += difference;
  }

  if (mode === 'trailing' && hunk.contextLines.length > contextSize) {
    hunk.contextLines.length = contextSize;
  }

  if (hunk.contextLines.length > 0) {
    hunk.hunkLines.push(...hunk.contextLines);
    hunk.additionCount += hunk.contextLines.length;
    hunk.deletionCount += hunk.contextLines.length;
    hunk.contextLines.length = 0;
  }
  return hunk;
}

function flushHunk(hunk: CurrentHunk, lines: string[]) {
  lines.push(
    `@@ -${formatHunkRange(hunk.deletionStart, hunk.deletionCount)} +${formatHunkRange(hunk.additionStart, hunk.additionCount)} @@`
  );
  lines.push(...hunk.hunkLines);
}

function formatHunkRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}
