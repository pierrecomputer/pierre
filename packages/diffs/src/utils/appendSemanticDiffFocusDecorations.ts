import type { DecorationItem } from '../types';
import type { SemanticDiffFocusSide } from './semanticDiffFocus';

// Copy just this source line's decorations into a hunk or window's coordinates.
// Full-file highlighting passes the cached array directly to Shiki instead.
export function appendSemanticDiffFocusDecorations(
  focus: SemanticDiffFocusSide,
  sourceLine: number,
  lineIndex: number,
  decorations: DecorationItem[]
): void {
  const line = focus.lines.get(sourceLine);
  if (line == null) return;
  const end = line.start + line.total;
  for (let index = line.start; index < end; index++) {
    const decoration = focus.decorations[index];
    decorations.push({
      start: { line: lineIndex, character: decoration.start.character },
      end: { line: lineIndex, character: decoration.end.character },
      properties: decoration.properties,
      alwaysWrap: decoration.alwaysWrap,
    });
  }
}
