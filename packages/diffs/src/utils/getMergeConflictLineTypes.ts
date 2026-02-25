export type MergeConflictLineType =
  | 'none'
  | 'marker-start'
  | 'marker-base'
  | 'marker-separator'
  | 'marker-end'
  | 'current'
  | 'base'
  | 'incoming';

type MergeConflictStage = 'current' | 'base' | 'incoming';

interface MergeConflictFrame {
  stage: MergeConflictStage;
}

const START_MARKER = /^<{7,}(?:\s.*)?$/;
const BASE_MARKER = /^\|{7,}(?:\s.*)?$/;
const SEPARATOR_MARKER = /^={7,}(?:\s.*)?$/;
const END_MARKER = /^>{7,}(?:\s.*)?$/;

function trimLineEnding(line: string): string {
  return line.replace(/(?:\r\n|\n|\r)$/, '');
}

export function getMergeConflictLineTypes(
  lines: string[]
): MergeConflictLineType[] {
  const lineTypes = new Array<MergeConflictLineType>(lines.length).fill('none');
  const stack: MergeConflictFrame[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = trimLineEnding(lines[index]);

    if (START_MARKER.test(line)) {
      stack.push({ stage: 'current' });
      lineTypes[index] = 'marker-start';
      continue;
    }

    const frame = stack.at(-1);
    if (frame == null) {
      continue;
    }

    if (BASE_MARKER.test(line)) {
      frame.stage = 'base';
      lineTypes[index] = 'marker-base';
      continue;
    }

    if (SEPARATOR_MARKER.test(line)) {
      frame.stage = 'incoming';
      lineTypes[index] = 'marker-separator';
      continue;
    }

    if (END_MARKER.test(line)) {
      stack.pop();
      lineTypes[index] = 'marker-end';
      continue;
    }

    lineTypes[index] = frame.stage;
  }

  return lineTypes;
}
