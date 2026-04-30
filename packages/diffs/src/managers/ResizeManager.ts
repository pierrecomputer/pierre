import type { ObservedAnnotationNodes, ObservedGridNodes } from '../types';

interface CodeColumnUpdate {
  codeInlineSize?: number;
  numberInlineSize?: number;
  measuredNumberInlineSize?: number;
}

type CodeUpdateMap = Map<ObservedGridNodes, CodeColumnUpdate>;

interface AnnotationSetup {
  child1: HTMLElement;
  child2: HTMLElement;
  item: ObservedAnnotationNodes;
  newHeight: number;
}

export class ResizeManager {
  private resizeObserver: ResizeObserver | undefined;
  private observedNodes = new Map<
    HTMLElement,
    ObservedAnnotationNodes | ObservedGridNodes
  >();

  setup(pre: HTMLPreElement, disableAnnotations: boolean): void {
    this.resizeObserver ??= new ResizeObserver(this.handleResizeObserver);
    const annotationUpdates = new Set<AnnotationSetup>();
    let columnCount = 0;
    const observedNodes = new Map(this.observedNodes);
    this.observedNodes.clear();

    for (const element of pre.children) {
      if (columnCount === 2) {
        break;
      }
      const codeElement: HTMLElement | undefined = (() => {
        if (element instanceof HTMLElement && element.tagName === 'CODE') {
          return element;
        }
        return undefined;
      })();
      if (codeElement == null) {
        continue;
      }
      columnCount++;
      let item: ObservedGridNodes | ObservedAnnotationNodes | undefined =
        observedNodes.get(codeElement);
      if (item != null && item.type !== 'code') {
        throw new Error(
          'ResizeManager.setup: somehow a code node is being used for an annotation, should be impossible'
        );
      }

      let numberElement = codeElement.firstElementChild;
      if (!(numberElement instanceof HTMLElement)) {
        numberElement = null;
      }
      if (item != null) {
        this.observedNodes.set(codeElement, item);
        observedNodes.delete(codeElement);
        if (item.numberElement !== numberElement) {
          if (item.numberElement != null) {
            this.resizeObserver.unobserve(item.numberElement);
            observedNodes.delete(item.numberElement);
          }
          if (numberElement != null) {
            this.resizeObserver.observe(numberElement);
            observedNodes.delete(numberElement);
            this.observedNodes.set(numberElement, item);
          }
          item.numberElement = numberElement;
          item.numberWidth = 0;
        } else if (item.numberElement != null) {
          observedNodes.delete(item.numberElement);
          this.observedNodes.set(item.numberElement, item);
          // If there is a resize, let the resize handler handle it...
        } else {
          item.numberWidth = 0;
        }
      } else {
        item = {
          type: 'code',
          codeElement,
          numberElement,
          codeWidth: 'auto',
          numberWidth: 0,
        };
        this.observedNodes.set(codeElement, item);
        this.resizeObserver.observe(codeElement);
        if (numberElement != null) {
          this.observedNodes.set(numberElement, item);
          this.resizeObserver.observe(numberElement);
        }
      }
    }

    if (columnCount > 1 && !disableAnnotations) {
      const annotationElements = pre.querySelectorAll(
        '[data-line-annotation*=","]'
      );

      const elementMap = new Map<string, HTMLElement[]>();
      // Iterate through all the matched elements and organize them into pairs
      // based on the data-line-annotation attribute
      for (const element of annotationElements) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }
        const lineAnnotation =
          element.getAttribute('data-line-annotation') ?? '';
        if (!/^\d+,\d+$/.test(lineAnnotation)) {
          console.error(
            'DiffFileRenderer.setupResizeObserver: Invalid element or annotation',
            { lineAnnotation, element }
          );
          continue;
        }
        let pairs = elementMap.get(lineAnnotation);
        if (pairs == null) {
          pairs = [];
          elementMap.set(lineAnnotation, pairs);
        }
        pairs.push(element);
      }

      for (const [key, pair] of elementMap) {
        if (pair.length !== 2) {
          console.error(
            'DiffFileRenderer.setupResizeObserver: Bad Pair',
            key,
            pair
          );
          continue;
        }
        const [container1, container2] = pair;
        const child1 = container1.firstElementChild;
        const child2 = container2.firstElementChild;
        if (
          !(container1 instanceof HTMLElement) ||
          !(container2 instanceof HTMLElement) ||
          !(child1 instanceof HTMLElement) ||
          !(child2 instanceof HTMLElement)
        ) {
          continue;
        }

        let item = observedNodes.get(child1);

        if (item != null) {
          this.observedNodes.set(child1, item);
          this.observedNodes.set(child2, item);
          observedNodes.delete(child1);
          observedNodes.delete(child2);
          continue;
        }

        const child1Height = child1.getBoundingClientRect().height;
        const child2Height = child2.getBoundingClientRect().height;
        item = {
          type: 'annotations',
          column1: {
            container: container1,
            child: child1,
            childHeight: child1Height,
          },
          column2: {
            container: container2,
            child: child2,
            childHeight: child2Height,
          },
          currentHeight: 'auto',
        };
        annotationUpdates.add({
          child1,
          child2,
          item,
          newHeight: Math.max(child1Height, child2Height),
        });
      }

      // Measure all annotation heights first, then apply the paired min-height
      // styles after the read phase so setup does not bounce between layout
      // reads and writes for every annotation pair.
      for (const pendingUpdate of annotationUpdates) {
        this.applyNewHeight(pendingUpdate.item, pendingUpdate.newHeight);
        this.observedNodes.set(pendingUpdate.child1, pendingUpdate.item);
        this.observedNodes.set(pendingUpdate.child2, pendingUpdate.item);
        this.resizeObserver.observe(pendingUpdate.child1);
        this.resizeObserver.observe(pendingUpdate.child2);
      }
      annotationUpdates.clear();
    }

    // Cleanup any old nodes that might still be observed
    for (const [element, item] of observedNodes) {
      this.resizeObserver.unobserve(element);
      if (item.type === 'code') {
        cleanupStaleCodeItem(item);
      } else {
        cleanupStaleAnnotationItem(item);
      }
    }
    observedNodes.clear();
  }

  cleanUp(): void {
    // Disconnect any existing observer and nodes
    this.resizeObserver?.disconnect();
    this.observedNodes.clear();
  }

  private handleResizeObserver = (entries: ResizeObserverEntry[]) => {
    const codeUpdates: CodeUpdateMap = new Map();
    const annotationUpdates: Set<ObservedAnnotationNodes> = new Set();
    for (const entry of entries) {
      const { target, borderBoxSize, contentBoxSize } = entry;
      if (!(target instanceof HTMLElement)) {
        console.error(
          'FileDiff.handleResizeObserver: Invalid element for ResizeObserver',
          entry
        );
        continue;
      }
      const item = this.observedNodes.get(target);
      if (item == null) {
        console.error(
          'FileDiff.handleResizeObserver: Not a valid observed node',
          entry
        );
        continue;
      }
      if (item.type === 'annotations') {
        const column = (() => {
          if (target === item.column1.child) {
            return item.column1;
          }
          if (target === item.column2.child) {
            return item.column2;
          }
          return undefined;
        })();

        if (column == null) {
          console.error(
            `FileDiff.handleResizeObserver: Couldn't find a column for`,
            { item, target }
          );
          continue;
        }

        column.childHeight = borderBoxSize[0].blockSize;
        annotationUpdates.add(item);
      } else if (item.type === 'code') {
        const update = codeUpdates.get(item) ?? {};
        const inlineSize = contentBoxSize[0].inlineSize;
        if (target === item.codeElement) {
          update.codeInlineSize = inlineSize;
        } else if (target === item.numberElement) {
          update.numberInlineSize = inlineSize;
        }
        codeUpdates.set(item, update);
      }
    }
    this.applyAnnotationUpdates(annotationUpdates);
    annotationUpdates.clear();
    this.applyColumnUpdates(codeUpdates);
    codeUpdates.clear();
  };

  private applyAnnotationUpdates(
    annotationUpdates: Set<ObservedAnnotationNodes>
  ) {
    for (const item of annotationUpdates) {
      this.applyNewHeight(
        item,
        Math.max(item.column1.childHeight, item.column2.childHeight)
      );
    }
  }

  private applyColumnUpdates = (queuedUpdates: CodeUpdateMap) => {
    for (const [item, update] of queuedUpdates) {
      const nextCodeWidth =
        update.codeInlineSize != null
          ? resolveCodeWidth(update.codeInlineSize)
          : item.codeWidth;
      const nextNumberWidth =
        update.numberInlineSize != null
          ? resolveNumberWidth(update.numberInlineSize)
          : item.numberWidth;
      const codeWidthChanged = nextCodeWidth !== item.codeWidth;
      const numberWidthChanged = nextNumberWidth !== item.numberWidth;

      if (!codeWidthChanged && !numberWidthChanged) {
        continue;
      }

      item.codeWidth = nextCodeWidth;
      item.numberWidth = nextNumberWidth;

      if (codeWidthChanged) {
        item.codeElement.style.setProperty(
          '--diffs-column-width',
          `${typeof nextCodeWidth === 'number' ? `${nextCodeWidth}px` : 'auto'}`
        );
      }

      if (numberWidthChanged) {
        item.codeElement.style.setProperty(
          '--diffs-column-number-width',
          `${nextNumberWidth === 0 ? 'auto' : `${nextNumberWidth}px`}`
        );
      }

      if (
        codeWidthChanged ||
        (numberWidthChanged && nextCodeWidth !== 'auto')
      ) {
        const targetWidth =
          typeof nextCodeWidth === 'number'
            ? Math.max(nextCodeWidth - nextNumberWidth, 0)
            : 0;
        item.codeElement.style.setProperty(
          '--diffs-column-content-width',
          `${targetWidth > 0 ? `${targetWidth}px` : 'auto'}`
        );
      }
    }
  };

  private applyNewHeight(item: ObservedAnnotationNodes, newHeight: number) {
    if (newHeight !== item.currentHeight) {
      item.currentHeight = Math.max(newHeight, 0);
      item.column1.container.style.setProperty(
        '--diffs-annotation-min-height',
        `${item.currentHeight}px`
      );
      item.column2.container.style.setProperty(
        '--diffs-annotation-min-height',
        `${item.currentHeight}px`
      );
    }
  }
}

function resolveCodeWidth(inlineSize: number): number | 'auto' {
  const width = Math.max(Math.floor(inlineSize), 0);
  return width === 0 ? 'auto' : width;
}

function resolveNumberWidth(inlineSize: number): number {
  return Math.max(Math.ceil(inlineSize), 0);
}

function cleanupStaleCodeItem(item: ObservedGridNodes): void {
  if (item.codeElement.isConnected) {
    item.codeElement.style.removeProperty('--diffs-column-content-width');
    item.codeElement.style.removeProperty('--diffs-column-number-width');
    item.codeElement.style.removeProperty('--diffs-column-width');
  }
}

function cleanupStaleAnnotationItem(item: ObservedAnnotationNodes): void {
  if (item.column1.container.isConnected) {
    item.column1.container.style.removeProperty(
      '--diffs-annotation-min-height'
    );
  }
  if (item.column2.container.isConnected) {
    item.column2.container.style.removeProperty(
      '--diffs-annotation-min-height'
    );
  }
}
