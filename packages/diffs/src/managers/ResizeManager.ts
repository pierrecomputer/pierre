import type { ObservedAnnotationNodes, ObservedGridNodes } from '../types';

type CodeColumnUpdate = [HTMLElement, number];

export class ResizeManager {
  private observedNodes = new Map<
    HTMLElement,
    ObservedAnnotationNodes | ObservedGridNodes
  >();
  private queuedUpdates: Map<ObservedGridNodes, CodeColumnUpdate[]> = new Map();

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
      const { target, borderBoxSize } = entry;
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
      const specs = borderBoxSize[0];
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

        column.childHeight = specs.blockSize;
        const newHeight = Math.max(
          item.column1.childHeight,
          item.column2.childHeight
        );
        this.applyNewHeight(item, newHeight);
      } else if (item.type === 'code') {
        const update: CodeColumnUpdate = [target, specs.inlineSize];
        const updates = this.queuedUpdates.get(item) ?? [];
        updates.push(update);
        this.queuedUpdates.set(item, updates);
      }
    }
    this.handleColumnChange();
  };

  private handleColumnChange = () => {
    for (const [item, updates] of this.queuedUpdates) {
      for (const [target, targetInlineSize] of updates) {
        // FIXME(amadeus): This needs to be re-worked with display: contents,
        // not sure setting to auto is a good assumption most of the time...
        if (target === item.codeElement) {
          const inlineSize = Math.max(Math.floor(targetInlineSize), 0);
          if (inlineSize !== item.codeWidth) {
            const targetWidth = Math.max(inlineSize - item.numberWidth, 0);
            item.codeWidth = inlineSize === 0 ? 'auto' : inlineSize;
            item.codeElement.style.setProperty(
              '--diffs-column-content-width',
              `${targetWidth > 0 ? `${targetWidth}px` : 'auto'}`
            );
            item.codeElement.style.setProperty(
              '--diffs-column-width',
              `${typeof item.codeWidth === 'number' ? `${item.codeWidth}px` : 'auto'}`
            );
          }
          if (
            item.numberElement != null &&
            typeof item.codeWidth === 'number' &&
            item.numberWidth === 0
          ) {
            updates.push([
              item.numberElement,
              item.numberElement.getBoundingClientRect().width,
            ]);
          }
        } else if (target === item.numberElement) {
          const inlineSize = Math.max(Math.ceil(targetInlineSize), 0);
          if (inlineSize !== item.numberWidth) {
            item.numberWidth = inlineSize;
            item.codeElement.style.setProperty(
              '--diffs-column-number-width',
              `${item.numberWidth === 0 ? 'auto' : `${item.numberWidth}px`}`
            );
            // We probably need to update code width variable if
            // `numberWidth` changed
            if (item.codeWidth !== 'auto') {
              const targetWidth = Math.max(
                item.codeWidth - item.numberWidth,
                0
              );
              item.codeElement.style.setProperty(
                '--diffs-column-content-width',
                `${targetWidth === 0 ? 'auto' : `${targetWidth}px`}`
              );
            }
          }
        }
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
