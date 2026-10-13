import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  type Connector,
  SemanticConnector,
} from '../src/components/SemanticConnector';
import { type DomHandle, installDom } from './domHarness';

const BOUNDS = { left: 0, top: 0, width: 40, height: 200 };

const MOVED: Connector = {
  id: 'moved',
  kind: 'moved',
  rank: 0,
  base: { top: 0, bottom: 20 },
  target: { top: 40, bottom: 60 },
};

// The SVG's children in paint order, with each separator rect's vertical
// extent.
function paintOrder(container: HTMLElement): unknown[] {
  const svg = container.querySelector('svg');
  if (svg == null) throw new Error('paintOrder: no SVG rendered');
  return Array.from(svg.children, (child) =>
    child.hasAttribute('data-connector-separators')
      ? Array.from(child.children, (rect) => [
          rect.getAttribute('y'),
          rect.getAttribute('height'),
        ])
      : child.getAttribute('data-connector-id')
  );
}

describe('SemanticConnector separators', () => {
  let dom: DomHandle;

  beforeEach(() => {
    dom = installDom();
  });

  afterEach(() => {
    dom.cleanup();
  });

  test('draws one rect per separator above every connector', () => {
    const container = document.createElement('div');
    const connector = new SemanticConnector();
    connector.render({
      container,
      bounds: BOUNDS,
      connectors: [MOVED],
      separators: [
        { top: 80, bottom: 112 },
        { top: 150, bottom: 154 },
      ],
    });
    expect(paintOrder(container)).toEqual([
      'moved',
      [
        ['80', '32'],
        ['150', '4'],
      ],
    ]);

    connector.render({
      container,
      bounds: BOUNDS,
      connectors: [MOVED, { ...MOVED, id: 'second' }],
      separators: [{ top: 90, bottom: 122 }],
    });
    expect(paintOrder(container)).toEqual(['moved', 'second', [['90', '32']]]);
  });
});
