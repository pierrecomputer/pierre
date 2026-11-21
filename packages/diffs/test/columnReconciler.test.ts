import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Element as HASTElement } from 'hast';

import { ColumnReconciler } from '../src/dom/ColumnReconciler';
import type { RowKey, RowSpec } from '../src/layout/RowSpec';
import { type DomHandle, installDom } from './domHarness';

let dom: DomHandle;

beforeEach(() => {
  dom = installDom();
});

afterEach(() => {
  dom.cleanup();
});

function cell(
  text: string,
  properties: HASTElement['properties'] = {}
): HASTElement {
  return {
    type: 'element',
    tagName: 'div',
    properties,
    children: [{ type: 'text', value: text }],
  };
}

// A line row keyed by its line, with a gutter number and content text.
function row(key: RowKey, text: string, lineType = 'context'): RowSpec {
  return {
    key,
    gutter: cell(key, {
      'data-column-number': key,
      'data-line-type': lineType,
    }),
    content: cell(text, { 'data-line': key, 'data-line-type': lineType }),
  };
}

function createColumns(): {
  gutter: HTMLElement;
  content: HTMLElement;
  reconciler: ColumnReconciler;
} {
  const gutter = document.createElement('div');
  const content = document.createElement('div');
  document.body.append(gutter, content);
  return { gutter, content, reconciler: new ColumnReconciler(gutter, content) };
}

function keysOf(column: HTMLElement): string[] {
  return Array.from(
    column.children,
    (child) => child.getAttribute('data-line') ?? ''
  );
}

function textsOf(column: HTMLElement): string[] {
  return Array.from(column.children, (child) => child.textContent ?? '');
}

describe('ColumnReconciler', () => {
  test('the first paint writes every row and later reconciles keep their elements', () => {
    const { gutter, content, reconciler } = createColumns();
    const specs = [row('a1', 'one'), row('a2', 'two'), row('a3', 'three')];
    const first = reconciler.reconcile(specs);
    expect([...first.changed]).toEqual(['a1', 'a2', 'a3']);
    expect(keysOf(content)).toEqual(['a1', 'a2', 'a3']);
    expect(gutter.childElementCount).toBe(3);
    const elements = Array.from(content.children);

    const second = reconciler.reconcile(specs);
    expect(second.changed.size).toBe(0);
    expect(Array.from(content.children)).toEqual(elements);
    expect<Element | undefined>(reconciler.elementFor('a2')?.content).toBe(
      elements[1]
    );
  });

  test('a window moving down removes rows at the top and appends at the bottom', () => {
    const { gutter, content, reconciler } = createColumns();
    const rows = Array.from({ length: 8 }, (_, index) =>
      row(`a${index}`, `line ${index}`)
    );
    reconciler.reconcile(rows.slice(0, 5));
    const kept = Array.from(content.children).slice(2);
    const result = reconciler.reconcile(rows.slice(2, 8));
    expect([...result.changed].sort()).toEqual(['a5', 'a6', 'a7']);
    expect(keysOf(content)).toEqual(['a2', 'a3', 'a4', 'a5', 'a6', 'a7']);
    expect(Array.from(content.children).slice(0, 3)).toEqual(kept);
    expect(Array.from(gutter.children, (child) => child.textContent)).toEqual([
      'a2',
      'a3',
      'a4',
      'a5',
      'a6',
      'a7',
    ]);
  });

  test('a window moving up prepends rows and trims the bottom', () => {
    const { content, reconciler } = createColumns();
    const rows = Array.from({ length: 8 }, (_, index) =>
      row(`a${index}`, `line ${index}`)
    );
    reconciler.reconcile(rows.slice(3, 8));
    const kept = Array.from(content.children).slice(0, 2);
    reconciler.reconcile(rows.slice(0, 5));
    expect(keysOf(content)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4']);
    expect(Array.from(content.children).slice(3)).toEqual(kept);
  });

  test('a patch hint rewrites the rows with the given keys and leaves the rest', () => {
    const { content, reconciler } = createColumns();
    const rows = [row('a1', 'one'), row('a2', 'two'), row('a3', 'three')];
    reconciler.reconcile(rows);
    const second = content.children[1];
    const patchedTwo = row('a2', 'TWO');
    const specs = [rows[0], patchedTwo, rows[2]];
    const result = reconciler.reconcile(specs, [patchedTwo, row('a9', 'nine')]);
    expect([...result.changed]).toEqual(['a2']);
    expect(textsOf(content)).toEqual(['one', 'TWO', 'three']);
    expect(content.children[1]).toBe(second);
    // The patched spec is what the next reconcile compares against.
    const again = reconciler.reconcile(specs);
    expect(again.changed.size).toBe(0);
  });

  test('reports when a gutter cell was rewritten', () => {
    const { reconciler } = createColumns();
    const rows = [row('a1', 'one'), row('a2', 'two')];
    reconciler.reconcile(rows);
    // The same line with a new number: its gutter cell is rewritten.
    const renumbered = {
      ...rows[1],
      gutter: cell('a9', rows[1].gutter.properties),
    };
    const result = reconciler.reconcile([rows[0], renumbered]);
    expect(result.gutterRewritten).toBe(true);
    expect(result.attributesReset).toBe(false);
    // Content alone changing leaves the gutter cells as they are.
    const retyped = {
      ...rows[0],
      content: cell('ONE', rows[0].content.properties),
    };
    expect(reconciler.reconcile([retyped, renumbered]).gutterRewritten).toBe(
      false
    );
  });

  test('a patch hint before the first paint writes the rows whole', () => {
    const { content, reconciler } = createColumns();
    const rows = [row('a1', 'one'), row('a2', 'two')];
    const result = reconciler.reconcile(rows, [rows[1]]);
    expect([...result.changed]).toEqual(['a1', 'a2']);
    expect(result.attributesReset).toBe(true);
    expect(textsOf(content)).toEqual(['one', 'two']);
  });

  test('inserting a row in the middle keeps the rows around it', () => {
    const { content, reconciler } = createColumns();
    const one = row('a1', 'one');
    const three = row('a3', 'three');
    reconciler.reconcile([one, three]);
    const [first, third] = Array.from(content.children);
    const result = reconciler.reconcile([one, row('a2', 'two'), three]);
    expect([...result.changed]).toEqual(['a2']);
    expect(Array.from(content.children)).toEqual([
      first,
      content.children[1],
      third,
    ]);
    expect(textsOf(content)).toEqual(['one', 'two', 'three']);
  });

  test('removing a row in the middle keeps the rows around it', () => {
    const { content, reconciler } = createColumns();
    const one = row('a1', 'one');
    const three = row('a3', 'three');
    reconciler.reconcile([one, row('a2', 'two'), three]);
    const [first, , third] = Array.from(content.children);
    const result = reconciler.reconcile([one, three]);
    expect(result.changed.size).toBe(0);
    expect(Array.from(content.children)).toEqual([first, third]);
    expect(reconciler.elementFor('a2')).toBeUndefined();
  });

  test('a row that moved is moved, not rebuilt', () => {
    const { content, reconciler } = createColumns();
    const one = row('a1', 'one');
    const annotation = row('ann:a1', 'note');
    const two = row('a2', 'two');
    reconciler.reconcile([one, annotation, two]);
    const note = content.children[1];
    const result = reconciler.reconcile([one, two, annotation]);
    expect(result.changed.size).toBe(0);
    expect(content.children[2]).toBe(note);
    expect(keysOf(content)).toEqual(['a1', 'a2', 'ann:a1']);
  });

  test('a changed spec rewrites attributes, and children only when they changed', () => {
    const { gutter, content, reconciler } = createColumns();
    const original = row('a1', 'one');
    reconciler.reconcile([original]);
    const element = content.children[0];
    const textNode = element.firstChild;

    // Same children array, new attributes: the text node survives.
    const retyped: RowSpec = {
      key: 'a1',
      gutter: original.gutter,
      content: {
        ...original.content,
        properties: { 'data-line': 'a1', 'data-line-type': 'change-addition' },
      },
    };
    let result = reconciler.reconcile([retyped]);
    expect([...result.changed]).toEqual(['a1']);
    expect(element.getAttribute('data-line-type')).toBe('change-addition');
    expect(element.firstChild).toBe(textNode);
    expect(gutter.children[0].getAttribute('data-line-type')).toBe('context');

    // New children: the content is rewritten in place.
    result = reconciler.reconcile([row('a1', 'uno', 'change-addition')]);
    expect(content.children[0]).toBe(element);
    expect(element.textContent).toBe('uno');
    expect(gutter.children[0].getAttribute('data-line-type')).toBe(
      'change-addition'
    );

    // A dropped attribute is removed.
    const bare: RowSpec = {
      key: 'a1',
      gutter: retyped.gutter,
      content: { ...retyped.content, properties: { 'data-line': 'a1' } },
    };
    reconciler.reconcile([bare]);
    expect(element.hasAttribute('data-line-type')).toBe(false);
  });

  test('a patched attribute is written the way a new row writes it', () => {
    const { content, reconciler } = createColumns();
    const original = row('a1', 'one');
    reconciler.reconcile([original]);
    const element = content.children[0];
    const classed: RowSpec = {
      key: 'a1',
      gutter: original.gutter,
      content: {
        ...original.content,
        properties: {
          ...original.content.properties,
          className: ['line', 'custom'],
          draggable: false,
          hidden: true,
        },
      },
    };
    reconciler.reconcile([classed]);
    expect(content.children[0]).toBe(element);
    expect(element.getAttribute('class')).toBe('line custom');
    expect(element.hasAttribute('draggable')).toBe(false);
    expect(element.getAttribute('hidden')).toBe('');
    const fresh = createColumns();
    fresh.reconciler.reconcile([classed]);
    expect(element.outerHTML).toBe(fresh.content.children[0].outerHTML);
  });

  test('a cell whose tag changed is replaced and keeps its key', () => {
    const { content, reconciler } = createColumns();
    const one = row('a1', 'one');
    const two = row('a2', 'two');
    reconciler.reconcile([one, two]);
    const second = content.children[1];
    const asButton: RowSpec = {
      key: 'a1',
      gutter: one.gutter,
      content: { ...one.content, tagName: 'button' },
    };
    const result = reconciler.reconcile([asButton, two]);
    expect([...result.changed]).toEqual(['a1']);
    expect(content.children[0].tagName).toBe('BUTTON');
    expect(content.children[0].textContent).toBe('one');
    expect(content.children[1]).toBe(second);
    expect<Element | undefined>(reconciler.elementFor('a1')?.content).toBe(
      content.children[0]
    );
    expect(reconciler.reconcile([asButton, two]).changed.size).toBe(0);
    reconciler.reconcile([two]);
    expect(keysOf(content)).toEqual(['a2']);
  });

  test('adopted markup is rewritten on the first reconcile and kept after', () => {
    const { gutter, content, reconciler } = createColumns();
    gutter.innerHTML = '<div>1</div><div>2</div>';
    content.innerHTML =
      '<div data-line="a1">stale</div><div data-line="a2">stale</div>';
    const specs = [row('a1', 'one'), row('a2', 'two')];
    expect(reconciler.adopt(specs)).toBe(true);
    const [first, second] = Array.from(content.children);
    const result = reconciler.reconcile(specs);
    expect([...result.changed]).toEqual(['a1', 'a2']);
    expect(Array.from(content.children)).toEqual([first, second]);
    expect(textsOf(content)).toEqual(['one', 'two']);
    expect(reconciler.reconcile(specs).changed.size).toBe(0);
  });

  test('adopt refuses markup with a different row count', () => {
    const { content, reconciler } = createColumns();
    content.innerHTML = '<div data-line="a1">one</div>';
    expect(reconciler.adopt([row('a1', 'one'), row('a2', 'two')])).toBe(false);
  });

  test('duplicate keys throw', () => {
    const { reconciler } = createColumns();
    reconciler.reconcile([row('a1', 'one')]);
    expect(() =>
      reconciler.reconcile([row('a1', 'one'), row('a1', 'again')])
    ).toThrow('duplicate row key');
  });
});
