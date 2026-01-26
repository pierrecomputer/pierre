import type { ObservedAnnotationNodes, ObservedGridNodes } from '../types';

export class ResizeManager {
  private observedNodes = new Map<
    HTMLElement,
    ObservedAnnotationNodes | ObservedGridNodes
  >();

  cleanUp(): void {
    // Disconnect any existing observer
    this.resizeObserver?.disconnect();
    this.observedNodes.clear();
  }

  private resizeObserver: ResizeObserver | undefined;

  setup(pre: HTMLPreElement): void {
    this.resizeObserver ??= new ResizeObserver(this.handleResizeObserver);
    const codeElements = pre.querySelectorAll('code');

    const observedNodes = new Map(this.observedNodes);
    this.observedNodes.clear();
    for (const codeElement of codeElements) {
      let item: ObservedGridNodes | ObservedAnnotationNodes | undefined =
        observedNodes.get(codeElement);
      if (item != null) {
        this.observedNodes.set(codeElement, item);
        observedNodes.delete(codeElement);
        continue;
      }
      let numberElement = codeElement.querySelector('[data-gutter]');
      if (!(numberElement instanceof HTMLElement)) {
        numberElement = null;
      }
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

    if (codeElements.length > 1) {
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
        if (target === item.codeElement) {
          const inlineSize = Math.floor(specs.inlineSize) - 1;
          if (inlineSize !== item.codeWidth) {
            item.codeWidth = inlineSize;
            item.codeElement.style.setProperty(
              '--diffs-column-content-width',
              `${Math.max(item.codeWidth - item.numberWidth, 0)}px`
            );
            item.codeElement.style.setProperty(
              '--diffs-column-width',
              `${item.codeWidth}px`
            );
          }
        } else if (target === item.numberElement) {
          const inlineSize = Math.ceil(specs.inlineSize);
          if (inlineSize !== item.numberWidth) {
            item.numberWidth = inlineSize;
            item.codeElement.style.setProperty(
              '--diffs-column-number-width',
              `${item.numberWidth}px`
            );
            // We probably need to update code width variable if
            // `numberWidth` changed
            if (item.codeWidth !== 'auto') {
              item.codeElement.style.setProperty(
                '--diffs-column-content-width',
                `${Math.max(item.codeWidth - item.numberWidth, 0)}px`
              );
            }
          }
        }
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
