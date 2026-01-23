import { HUNK_HEADER } from 'src/constants';

interface CurrentHunk {
  hunkContextString: string;
  additionStart: number;
  deletionStart: number;
  additionCount: number;
  deletionCount: number;
  hunkLines: string[];
  contextLines: string[];
}

export function trimPatchContent(patch: string, contextSize = 10): string {
  const lines: string[] = [];

  let currentHunk: CurrentHunk | undefined;
  for (const line of patch.split('\n')) {
    const parsedHunkHeader = line.match(HUNK_HEADER);
    if (parsedHunkHeader != null) {
      if (currentHunk != null) {
        if (currentHunk.hunkLines.length > 0) {
          flushContextLines(currentHunk, contextSize);
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
        isNaN(deletionCount) ||
        (deletionCount < contextSize && additionCount < contextSize)
      ) {
        lines.push(line);
      } else {
        currentHunk = {
          hunkContextString: parsedHunkHeader[5] ?? '',
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
      // If we've exceeded double our context window size + 1, that means we
      // should create a new hunk...
      if (
        currentHunk.hunkLines.length > 0 &&
        currentHunk.contextLines.length === contextSize * 2 + 1
      ) {
        const removedItems = currentHunk.contextLines.slice(contextSize);
        flushContextLines(currentHunk, contextSize);
        const {
          additionCount: emittedAdditionCount,
          deletionCount: emittedDeletionCount,
        } = currentHunk;
        flushHunk(currentHunk, lines);

        removedItems.shift();
        currentHunk = {
          ...currentHunk,
          additionStart: currentHunk.additionStart + emittedAdditionCount + 1,
          deletionStart: currentHunk.deletionStart + emittedDeletionCount + 1,
          deletionCount: 0,
          additionCount: 0,
          contextLines: removedItems,
          hunkLines: [],
        };
      }
    } else if (line !== '') {
      flushContextLines(currentHunk, contextSize);
      currentHunk.hunkLines.push(line);
      if (line.startsWith('+')) {
        currentHunk.additionCount += 1;
      } else if (line.startsWith('-')) {
        currentHunk.deletionCount += 1;
      }
    }
  }

  if (currentHunk != null && currentHunk.hunkLines.length > 0) {
    console.log(currentHunk);
    flushContextLines(currentHunk, contextSize);
    flushHunk(currentHunk, lines);
  }

  return lines.join('\n');
}

function flushContextLines(hunk: CurrentHunk, contextSize: number) {
  if (hunk.contextLines.length > contextSize) {
    // If this context group is at the beginning of the hunk, truncate from the
    // beginning
    if (hunk.hunkLines.length === 0) {
      const difference = hunk.contextLines.length - contextSize;
      hunk.contextLines.splice(0, difference);
      hunk.additionStart += difference;
      hunk.deletionStart += difference;
    } else {
      hunk.contextLines.length = contextSize;
    }
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
  // NOTE(amadeus): Ensure we are handling cases where the count isn't being passed...
  lines.push(
    `@@ -${formatHunkRange(hunk.deletionStart, hunk.deletionCount)} +${formatHunkRange(hunk.additionStart, hunk.additionCount)} @@${hunk.hunkContextString !== '' ? ` ${hunk.hunkContextString}` : ''}`
  );
  lines.push(...hunk.hunkLines);
}

function formatHunkRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}
