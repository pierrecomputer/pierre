import type { DiffLineAnnotation } from '../types';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import type { TextDocumentChange } from './textDocument';
import { getLineNumberAttr, h } from './utils';

interface LineAnnotationChange {
  readonly startLine: number;
  readonly startCharacter: number;
  readonly endLine: number;
  readonly deletesEndLine: boolean;
  readonly insertedLineBreaks: number;
  readonly lineDelta: number;
}

export function applyDocumentChangeToLineAnnotations<T>(
  change: TextDocumentChange,
  lineAnnotations: DiffLineAnnotation<T>[]
): DiffLineAnnotation<T>[] | undefined {
  const annotationChanges = getLineAnnotationChanges(change);
  if (annotationChanges.length === 0) {
    return undefined;
  }

  const nextLineAnnotations: DiffLineAnnotation<T>[] = [];
  let changed = false;
  for (const annotation of lineAnnotations) {
    if (annotation.side === 'deletions' || annotation.lineNumber <= 0) {
      nextLineAnnotations.push(annotation);
      continue;
    }

    let line: number | undefined = annotation.lineNumber - 1;
    let lineCount = change.previousLineCount;
    let annotationChanged = false;
    for (const lineChange of annotationChanges) {
      const nextLineCount = Math.max(1, lineCount + lineChange.lineDelta);
      const nextLine = mapLineThroughLineChange(
        line,
        lineChange,
        nextLineCount
      );
      if (nextLine === undefined) {
        annotationChanged = true;
        line = undefined;
        break;
      }
      if (
        nextLine !== line ||
        lineChangeTouchesAnnotationLine(line, lineChange)
      ) {
        annotationChanged = true;
      }
      line = nextLine;
      lineCount = nextLineCount;
    }

    if (line === undefined) {
      changed = true;
      continue;
    }

    const lineNumber = line + 1;
    if (annotationChanged) {
      nextLineAnnotations.push(
        lineNumber === annotation.lineNumber
          ? annotation
          : {
              ...annotation,
              lineNumber,
            }
      );
      changed = true;
      continue;
    }

    nextLineAnnotations.push(annotation);
  }

  return changed ? nextLineAnnotations : undefined;
}

function getLineAnnotationChanges(
  change: TextDocumentChange
): readonly LineAnnotationChange[] {
  if (change.lineDelta === 0) {
    if (change.changedLineChanges !== undefined) {
      return change.changedLineChanges.flatMap(
        ([startLine, _endLine, lineDelta]) => {
          if (lineDelta === 0) {
            return [];
          }
          const removedLineCount = Math.max(0, -lineDelta);
          return [
            {
              startLine,
              startCharacter: 0,
              endLine: startLine + removedLineCount,
              deletesEndLine: false,
              insertedLineBreaks: Math.max(0, lineDelta),
              lineDelta,
            },
          ];
        }
      );
    }

    return change.changedLineRanges.flatMap(([startLine, endLine]) => {
      const insertedLineBreaks = endLine - startLine;
      if (insertedLineBreaks <= 0) {
        return [];
      }
      return [
        {
          startLine,
          startCharacter: 0,
          endLine: startLine,
          deletesEndLine: false,
          insertedLineBreaks,
          lineDelta: insertedLineBreaks,
        },
      ];
    });
  }
  const removedLineCount = Math.max(0, -change.lineDelta);
  const deletedToDocumentEnd =
    change.startLine === 0 &&
    change.startCharacter === 0 &&
    change.lineCount === 1 &&
    change.lineDelta === 1 - change.previousLineCount;
  return [
    {
      startLine: change.startLine,
      startCharacter: change.startCharacter,
      endLine: change.startLine + removedLineCount,
      deletesEndLine: deletedToDocumentEnd,
      insertedLineBreaks: Math.max(0, change.lineDelta),
      lineDelta: change.lineDelta,
    },
  ];
}

function mapLineThroughLineChange(
  line: number,
  lineChange: LineAnnotationChange,
  nextLineCount: number
): number | undefined {
  if (line < lineChange.startLine) {
    return line;
  }

  if (
    line > lineChange.endLine ||
    (lineChange.endLine > lineChange.startLine &&
      line === lineChange.endLine &&
      !lineChange.deletesEndLine)
  ) {
    return line + lineChange.lineDelta;
  }

  if (lineChange.startLine === lineChange.endLine) {
    if (lineChange.startCharacter === 0) {
      return line + lineChange.insertedLineBreaks;
    }
    return line;
  }

  if (lineChangeDeletesAnnotationLine(line, lineChange)) {
    return undefined;
  }

  const replacementLineOffset = Math.min(
    Math.max(0, line - lineChange.startLine),
    lineChange.insertedLineBreaks
  );
  return clampLine(lineChange.startLine + replacementLineOffset, nextLineCount);
}

function lineChangeDeletesAnnotationLine(
  line: number,
  lineChange: LineAnnotationChange
): boolean {
  if (
    lineChange.lineDelta >= 0 ||
    line < lineChange.startLine ||
    line > lineChange.endLine
  ) {
    return false;
  }
  if (line === lineChange.startLine && lineChange.startCharacter > 0) {
    return false;
  }
  if (line === lineChange.endLine && !lineChange.deletesEndLine) {
    return false;
  }
  return true;
}

function lineChangeTouchesAnnotationLine(
  line: number,
  lineChange: LineAnnotationChange
): boolean {
  if (
    lineChange.lineDelta === 0 ||
    line < lineChange.startLine ||
    line > lineChange.endLine
  ) {
    return false;
  }
  return !(
    lineChange.endLine > lineChange.startLine &&
    line === lineChange.endLine &&
    !lineChange.deletesEndLine
  );
}

function clampLine(line: number, lineCount: number): number {
  return Math.max(0, Math.min(line, Math.max(0, lineCount - 1)));
}

export function renderLineAnnotations<LAnnotation>(
  lineAnnotations: DiffLineAnnotation<LAnnotation>[],
  contentEl: HTMLElement,
  gutterEl?: HTMLElement
): void {
  const additionAnnotations = new Map<number, string[]>();
  const deletionAnnotations = new Map<number, string[]>();
  for (const annotation of lineAnnotations) {
    const lineNumber = annotation.lineNumber;
    if (!additionAnnotations.has(lineNumber)) {
      additionAnnotations.set(lineNumber, []);
    }
    if (!deletionAnnotations.has(lineNumber)) {
      deletionAnnotations.set(lineNumber, []);
    }
    const map =
      annotation.side === 'deletions'
        ? deletionAnnotations
        : additionAnnotations;
    map.get(lineNumber)!.push(getLineAnnotationName(annotation));
  }

  const leftCodeElement = contentEl.parentElement?.previousElementSibling;
  let leftGutterElement: HTMLElement | undefined;
  let leftContentElement: HTMLElement | undefined;
  if (
    leftCodeElement != null &&
    leftCodeElement instanceof HTMLElement &&
    leftCodeElement.dataset.deletions !== undefined
  ) {
    for (const child of leftCodeElement.children) {
      const el = child as HTMLElement;
      const { gutter, content } = el.dataset;
      if (gutter !== undefined) {
        leftGutterElement = el;
      } else if (content !== undefined) {
        leftContentElement = el;
      }
    }
  }

  cleanLineAnnotationElements(contentEl, gutterEl);
  if (leftContentElement !== undefined) {
    cleanLineAnnotationElements(leftContentElement, leftGutterElement);
  }

  const additionsAnnotationElements = createLineAnnotationElements(
    additionAnnotations,
    contentEl,
    gutterEl
  );
  if (leftContentElement === undefined) {
    return;
  }

  const deletionsAnnotationElements = createLineAnnotationElements(
    deletionAnnotations,
    leftContentElement,
    leftGutterElement
  );

  requestAnimationFrame(() => {
    syncPairedLineAnnotationHeights(
      additionAnnotations,
      deletionAnnotations,
      additionsAnnotationElements,
      deletionsAnnotationElements
    );
  });
}

function cleanLineAnnotationElements(
  contentEl: HTMLElement,
  gutterEl?: HTMLElement
): void {
  const staleElements: HTMLElement[] = [];
  for (let i = 1; i < contentEl.childElementCount; i++) {
    const el = contentEl.children[i] as HTMLElement;
    if (el.dataset.lineAnnotation !== undefined) {
      staleElements.push(el);
      if (gutterEl !== undefined) {
        staleElements.push(gutterEl.children[i] as HTMLElement);
      }
    }
  }
  for (const el of staleElements) {
    el.remove();
  }
}

function createLineAnnotationElements(
  lineAnnotations: Map<number, string[]>,
  contentEl: HTMLElement,
  gutterEl?: HTMLElement
): Map<number, HTMLElement> {
  const annotationElements = new Map<number, HTMLElement>();
  for (const el of contentEl.children) {
    const lineNumber = getLineNumberAttr(el as HTMLElement);
    if (lineNumber !== undefined) {
      const annotations = lineAnnotations.get(lineNumber);
      if (annotations !== undefined) {
        const lineIndex = lineNumber - 1;
        const annotationElement = h('div', {
          dataset: {
            lineAnnotation: '0,' + lineIndex,
          },
          children: [
            h('div', {
              dataset: 'annotationContent',
              children: annotations.map((name) => h('slot', { name })),
            }),
          ],
        });
        el.after(annotationElement);
        annotationElements.set(lineNumber, annotationElement);
      }
    }
  }

  if (gutterEl !== undefined) {
    for (const el of gutterEl.children) {
      const lineNumber = getLineNumberAttr(el as HTMLElement, 'columnNumber');
      if (lineNumber !== undefined && lineAnnotations.has(lineNumber)) {
        const bufferEl = h('div', {
          dataset: {
            gutterBuffer: 'annotation',
            bufferSize: '1',
          },
          style: {
            gridRow: 'span 1',
          },
        });
        el.after(bufferEl);
      }
    }
  }

  return annotationElements;
}

function syncPairedLineAnnotationHeights(
  additionAnnotations: Map<number, string[]>,
  deletionAnnotations: Map<number, string[]>,
  additionAnnotationElements: Map<number, HTMLElement>,
  deletionAnnotationElements: Map<number, HTMLElement>
): void {
  const offsetHeights = new Map<number, number>();
  for (const [lineNumber, annotations] of additionAnnotations.entries()) {
    const annotationElement = deletionAnnotationElements.get(lineNumber);
    if (annotations.length === 0 && annotationElement !== undefined) {
      const height = measureAnnotationContentHeight(annotationElement);
      if (height > 0) {
        offsetHeights.set(lineNumber, height);
      }
    }
  }
  for (const [lineNumber, annotations] of deletionAnnotations.entries()) {
    const annotationElement = additionAnnotationElements.get(lineNumber);
    if (annotations.length === 0 && annotationElement !== undefined) {
      const height = measureAnnotationContentHeight(annotationElement);
      if (height > 0) {
        offsetHeights.set(lineNumber, height);
      }
    }
  }
  applyLineAnnotationMinHeights(
    additionAnnotations,
    additionAnnotationElements,
    offsetHeights
  );
  applyLineAnnotationMinHeights(
    deletionAnnotations,
    deletionAnnotationElements,
    offsetHeights
  );
}

function measureAnnotationContentHeight(lineAnnotationEl: HTMLElement): number {
  const content = lineAnnotationEl.firstElementChild;
  if (!(content instanceof HTMLElement)) {
    return 0;
  }
  return content.getBoundingClientRect().height;
}

function applyLineAnnotationMinHeights(
  lineAnnotations: Map<number, string[]>,
  annotationElements: Map<number, HTMLElement>,
  offsetHeights: Map<number, number>
): void {
  for (const [lineNumber, annotationElement] of annotationElements.entries()) {
    const annotations = lineAnnotations.get(lineNumber);
    const offsetHeight = offsetHeights.get(lineNumber);
    if (annotations?.length === 0 && offsetHeight !== undefined) {
      annotationElement.style.setProperty(
        '--diffs-annotation-min-height',
        `${offsetHeight}px`
      );
    }
  }
}
