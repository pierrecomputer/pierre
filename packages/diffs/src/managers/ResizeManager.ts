import type { ObservedAnnotationNodes, ObservedGridNodes } from '../types';

interface QueuedCodeColumnUpdate {
  codeInlineSize?: number;
  numberInlineSize?: number;
  measuredNumberInlineSize?: number;
}

export class ResizeManager {
  private observedNodes = new Map<
    HTMLElement,
    ObservedAnnotationNodes | ObservedGridNodes
  >();
  private queuedUpdates: Map<ObservedGridNodes, QueuedCodeColumnUpdate> =
    new Map();

  cleanUp(): void {
    // Disconnect any existing observer
    this.resizeObserver?.disconnect();
    this.observedNodes.clear();
    this.queuedUpdates.clear();
  }

  private resizeObserver: ResizeObserver | undefined;

  setup(pre: HTMLPreElement, disableAnnotations: boolean): void {
    this.resizeObserver ??= new ResizeObserver(this.handleResizeObserver);
    const codeElements = pre.querySelectorAll('code');

    const observedNodes = new Map(this.observedNodes);
    this.observedNodes.clear();
    for (const codeElement of codeElements) {
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
          }
          if (numberElement != null) {
            this.resizeObserver.observe(numberElement);
            observedNodes.delete(numberElement);
            this.observedNodes.set(numberElement, item);
          }
          item.numberElement = numberElement;
        } else if (item.numberElement != null) {
          observedNodes.delete(item.numberElement);
          this.observedNodes.set(item.numberElement, item);
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

    if (codeElements.length > 1 && !disableAnnotations) {
      const annotationElements = pre.querySelectorAll(
        '[data-line-annotation*=","]'
      );

      const elementMap = new Map<string, HTMLElement[]>();
      for (const element of annotationElements) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }
        const { lineAnnotation = '' } = element.dataset;
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

        item = {
          type: 'annotations',
          column1: {
            container: container1,
            child: child1,
            childHeight: child1.getBoundingClientRect().height,
          },
          column2: {
            container: container2,
            child: child2,
            childHeight: child2.getBoundingClientRect().height,
          },
          currentHeight: 'auto',
        };

        const newHeight = Math.max(
          item.column1.childHeight,
          item.column2.childHeight
        );
        this.applyNewHeight(item, newHeight);

        this.observedNodes.set(child1, item);
        this.observedNodes.set(child2, item);
        this.resizeObserver.observe(child1);
        this.resizeObserver.observe(child2);
      }
    }

    for (const element of observedNodes.keys()) {
      if (element.isConnected) {
        element.style.removeProperty('--diffs-column-content-width');
        element.style.removeProperty('--diffs-column-number-width');
        element.style.removeProperty('--diffs-column-width');
        if (element.parentElement instanceof HTMLElement) {
          element.parentElement.style.removeProperty(
            '--diffs-annotation-min-height'
          );
        }
      }
      this.resizeObserver.unobserve(element);
    }
    observedNodes.clear();
  }

  private handleResizeObserver = (entries: ResizeObserverEntry[]) => {
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
        const newHeight = Math.max(
          item.column1.childHeight,
          item.column2.childHeight
        );
        this.applyNewHeight(item, newHeight);
      } else if (item.type === 'code') {
        const update = this.queuedUpdates.get(item) ?? {};
        const inlineSize = contentBoxSize[0].inlineSize;
        if (target === item.codeElement) {
          update.codeInlineSize = inlineSize;
        } else if (target === item.numberElement) {
          update.numberInlineSize = inlineSize;
        }
        this.queuedUpdates.set(item, update);
      }
    }
    this.handleColumnChange();
  };

  private handleColumnChange = () => {
    // Measure any fallback widths up front so we do not interleave layout reads
    // with the style writes below.
    for (const [item, update] of this.queuedUpdates) {
      if (
        update.codeInlineSize != null &&
        update.numberInlineSize == null &&
        item.numberElement != null &&
        item.numberWidth === 0
      ) {
        update.measuredNumberInlineSize =
          item.numberElement.getBoundingClientRect().width;
      }
    }

    for (const [item, update] of this.queuedUpdates) {
      const nextCodeWidth =
        update.codeInlineSize != null
          ? resolveCodeWidth(update.codeInlineSize)
          : item.codeWidth;
      const nextNumberWidth =
        update.numberInlineSize != null
          ? resolveNumberWidth(update.numberInlineSize)
          : update.measuredNumberInlineSize != null
            ? resolveNumberWidth(update.measuredNumberInlineSize)
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
    this.queuedUpdates.clear();
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
