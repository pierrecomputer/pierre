import type { AnnotationSpan, LineInfo, LineSpans } from '../types';

export function pushOrMergeSpan(
  span: LineSpans | undefined,
  index: number,
  spanMap: Record<number, LineInfo | undefined>
): void {
  if (span == null) {
    return;
  }
  let lineInfo = spanMap[index];
  // If we need to inject a gap at the top of a column, then we'll make a
  // `fake` lineInfo for it.
  if (lineInfo == null && index === 0 && span.type === 'gap') {
    lineInfo = {
      type: 'context',
      lineNumber: -1,
      lineIndex: -1,
      spans: [],
    };
    spanMap[0] = lineInfo;
  } else if (lineInfo == null) {
    console.error('pushOrMergeSpan: Attempting to apply an invalid span', {
      span,
      index,
      spanMap,
    });
    return;
  }
  const spans = lineInfo.spans ?? [];
  lineInfo.spans = spans;
  if (spans.length === 0) {
    spans.push(span);
  }
  // If we get in here, we may need to split up some gaps to split up some gaps
  else {
    let gapSize = span.type === 'gap' ? span.rows : 0;
    const annotations: AnnotationSpan[] = [];
    let merged = false;
    for (const item of spans) {
      if (item.type === 'annotation') {
        if (span.type === 'annotation' && span.lineIndex === item.lineIndex) {
          merged = true;
          item.annotations = mergeAnnotations(
            item.annotations,
            span.annotations
          );
        }
        annotations.push(item);
      } else {
        gapSize += item.rows;
      }
    }
    if (span.type === 'annotation' && !merged) {
      annotations.push(span);
    }
    const spanMarkers: (AnnotationSpan | 0)[] = new Array(gapSize).fill(0);
    for (const annotation of annotations) {
      const annotationIndex = annotation.lineIndex - lineInfo.lineIndex;
      const currentItem = spanMarkers[annotationIndex];
      if (currentItem === 0 || currentItem == null) {
        spanMarkers.splice(annotationIndex, 0, annotation);
      } else {
        // NOTE(amadeus): Hopefully we never get in here, but theoretically
        // it's possible... so we'll merge the annotations together
        currentItem.annotations = mergeAnnotations(
          currentItem.annotations,
          annotation.annotations
        );
      }
    }
    const newSpans: LineSpans[] = [];
    let spanSize = 0;
    for (const item of spanMarkers) {
      if (item === 0) {
        spanSize++;
      } else {
        if (spanSize > 0) {
          newSpans.push({ type: 'gap', rows: spanSize });
          spanSize = 0;
        }
        newSpans.push(item);
      }
    }
    if (spanSize > 0) {
      newSpans.push({ type: 'gap', rows: spanSize });
    }
    lineInfo.spans = newSpans;
  }
}

function mergeAnnotations(base: string[], newAnnotations: string[]): string[] {
  if (newAnnotations.length === 0) {
    return base;
  }
  const baseSet = new Set(base);
  for (const item of newAnnotations) {
    baseSet.add(item);
  }
  return Array.from(baseSet);
}
