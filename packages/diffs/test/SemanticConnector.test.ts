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

// The SVG's children in paint order: the selection band's vertical extent (or
// 'hidden'), connector paths by ID, and each separator rect's vertical extent.
function paintOrder(container: HTMLElement): unknown[] {
  const svg = container.querySelector('svg');
  if (svg == null) throw new Error('paintOrder: no SVG rendered');
  return Array.from(svg.children, (child) => {
    if (child.hasAttribute('data-connector-selection')) {
      return child.getAttribute('display') === 'none'
        ? ['selection', 'hidden']
        : ['selection', child.getAttribute('y'), child.getAttribute('height')];
    }
    if (child.hasAttribute('data-connector-separators')) {
      return Array.from(child.children, (rect) => [
        rect.getAttribute('y'),
        rect.getAttribute('height'),
      ]);
    }
    return child.getAttribute('data-connector-id');
  });
}

describe('SemanticConnector layers', () => {
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
      selection: undefined,
    });
    expect(paintOrder(container)).toEqual([
      ['selection', 'hidden'],
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
      selection: undefined,
    });
    expect(paintOrder(container)).toEqual([
      ['selection', 'hidden'],
      'moved',
      'second',
      [['90', '32']],
    ]);
  });

  test('draws the selection below every connector and redraws it alone', () => {
    const container = document.createElement('div');
    const connector = new SemanticConnector();
    connector.render({
      container,
      bounds: BOUNDS,
      connectors: [MOVED],
      separators: [],
      selection: { top: 20, bottom: 60 },
    });
    expect(paintOrder(container)).toEqual([
      ['selection', '20', '40'],
      'moved',
      [],
    ]);

    connector.renderSelection({ top: 100, bottom: 120 });
    expect(paintOrder(container)).toEqual([
      ['selection', '100', '20'],
      'moved',
      [],
    ]);

    connector.renderSelection(undefined);
    expect(paintOrder(container)).toEqual([
      ['selection', 'hidden'],
      'moved',
      [],
    ]);
  });
});
