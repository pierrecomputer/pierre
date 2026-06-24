import type { DiffLineAnnotation } from '../types';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import type { TextDocumentChange } from './textDocument';
import { getLineNumberAttr, h } from './utils';

export function applyDocumentChangeToLineAnnotations<T>(
  change: TextDocumentChange,
  lineAnnotations: DiffLineAnnotation<T>[]
): DiffLineAnnotation<T>[] | undefined {
  if (change.lineDelta === 0) {
    return undefined;
  }

  const startCharacter = change.startCharacter;
  const removedLineCount = Math.max(0, -change.lineDelta);
  const deletedStartLine =
    removedLineCount === 0
      ? undefined
      : change.startLine + (startCharacter === 0 ? 0 : 1);
  const deletedEndLine =
    deletedStartLine === undefined
      ? undefined
      : deletedStartLine + removedLineCount;
  const shiftFromLine =
    removedLineCount > 0
      ? change.startLine + removedLineCount
      : change.startLine + (startCharacter === 0 ? 0 : 1);
  const nextLineAnnotations: DiffLineAnnotation<T>[] = [];

  let changed = false;
  for (const annotation of lineAnnotations) {
    if (annotation.side === 'deletions') {
      nextLineAnnotations.push(annotation);
      continue;
    }

    const line = annotation.lineNumber - 1;
    if (
      deletedStartLine !== undefined &&
      deletedEndLine !== undefined &&
      line >= deletedStartLine &&
      line < deletedEndLine
    ) {
      changed = true;
      continue;
    }

    if (line >= shiftFromLine) {
      nextLineAnnotations.push({
        ...annotation,
        lineNumber: line + change.lineDelta + 1,
      });
      changed = true;
      continue;
    }

    nextLineAnnotations.push(annotation);
  }

  return changed ? nextLineAnnotations : undefined;
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
