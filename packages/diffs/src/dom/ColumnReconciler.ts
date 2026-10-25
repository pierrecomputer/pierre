import type { Element as HASTElement } from 'hast';

import type { RowKey, RowSpec } from '../layout/RowSpec';
import { attributeFor, hastToHtml } from '../utils/hastToHtml';

// One row on screen: its gutter and content elements, and the spec they were
// last written from. `spec` is undefined for rows adopted from markup this
// reconciler did not write, so the next reconcile rewrites them.
interface Row {
  gutter: HTMLElement;
  content: HTMLElement;
  spec: RowSpec | undefined;
}

export interface ReconcileResult {
  /** Keys of rows that were inserted or whose cells were rewritten. */
  changed: Set<RowKey>;
}

/**
 * Keeps a code column's gutter and content children in step with a list of
 * row specs, by key. The first paint writes one string per column. After
 * that, a reconcile walks the specs once against the children: rows whose
 * key is gone are removed, missing rows are inserted (contiguous runs as one
 * string), rows that moved are moved, and rows whose spec changed have their
 * attributes and children rewritten. A row whose spec is the same object as
 * last time is not touched, so the layout's memoization decides the cost.
 */
export class ColumnReconciler {
  readonly #gutter: HTMLElement;
  readonly #content: HTMLElement;
  readonly #rows = new Map<RowKey, Row>();
  readonly #keys = new WeakMap<Element, RowKey>();
  // The specs the children were written from, until `#rows` is built from
  // them on the first incremental reconcile.
  #unindexed: { specs: readonly RowSpec[]; trusted: boolean } | undefined;
  #hasRows = false;

  constructor(gutter: HTMLElement, content: HTMLElement) {
    this.#gutter = gutter;
    this.#content = content;
  }

  /** Writes every row with one string per column. */
  replaceAll(specs: readonly RowSpec[]): void {
    this.#gutter.innerHTML = hastToHtml(specs.map((spec) => spec.gutter));
    this.#content.innerHTML = hastToHtml(specs.map((spec) => spec.content));
    this.#rows.clear();
    this.#unindexed = { specs, trusted: true };
    this.#hasRows = true;
  }

  /**
   * Takes the rows already in the columns, such as server-rendered markup,
   * as the rows for `specs`, matched by position. Their contents are not
   * trusted, so the next reconcile rewrites them. Returns false, and changes
   * nothing, when the row counts do not match.
   */
  adopt(specs: readonly RowSpec[]): boolean {
    if (
      this.#content.childElementCount !== specs.length ||
      this.#gutter.childElementCount !== specs.length
    ) {
      return false;
    }
    this.#rows.clear();
    this.#unindexed = { specs, trusted: false };
    this.#hasRows = true;
    return true;
  }

  /** The elements of the row with this key, if it is on screen. */
  elementFor(
    key: RowKey
  ): { gutter: HTMLElement; content: HTMLElement } | undefined {
    this.#index();
    return this.#rows.get(key);
  }

  /**
   * Removes the rows whose keys are not in `specs`, ahead of a reconcile with
   * the same specs. Called for every column before any column takes new rows,
   * so the columns of a split view shrink together and the tree is at its
   * smallest while the new rows parse.
   */
  removeStale(specs: readonly RowSpec[]): void {
    if (!this.#hasRows) return;
    this.#index();
    const keep = new Set<RowKey>();
    for (const spec of specs) keep.add(spec.key);
    for (const [key, row] of this.#rows) {
      if (!keep.has(key)) {
        row.gutter.remove();
        row.content.remove();
        this.#rows.delete(key);
      }
    }
  }

  /** Brings the columns in step with `specs`. */
  reconcile(specs: readonly RowSpec[]): ReconcileResult {
    if (!this.#hasRows) {
      this.replaceAll(specs);
      return { changed: new Set(specs.map((spec) => spec.key)) };
    }
    this.#index();
    const { changed } = this.#walk(specs);
    return { changed };
  }

  #walk(specs: readonly RowSpec[]): ReconcileResult {
    const gutter = this.#gutter;
    const content = this.#content;
    const rows = this.#rows;
    const changed = new Set<RowKey>();
    const nextKeys = new Set<RowKey>();
    for (const spec of specs) {
      if (nextKeys.has(spec.key)) {
        throw new Error(`ColumnReconciler: duplicate row key "${spec.key}"`);
      }
      nextKeys.add(spec.key);
    }

    let cursor = content.firstElementChild;
    let gutterCursor = gutter.firstElementChild;
    const advance = () => {
      cursor = cursor?.nextElementSibling ?? null;
      gutterCursor = gutterCursor?.nextElementSibling ?? null;
    };
    const removeAtCursor = () => {
      const key = this.#keyOf(cursor);
      const next = cursor?.nextElementSibling ?? null;
      const nextGutter = gutterCursor?.nextElementSibling ?? null;
      cursor?.remove();
      gutterCursor?.remove();
      rows.delete(key);
      cursor = next;
      gutterCursor = nextGutter;
    };

    // Rows to insert before the cursor, written as one string per column.
    let pending: RowSpec[] = [];
    const flushPending = () => {
      if (pending.length === 0) return;
      const gutterCells = insertRun(
        gutter,
        gutterCursor,
        pending.map((spec) => spec.gutter)
      );
      const contentCells = insertRun(
        content,
        cursor,
        pending.map((spec) => spec.content)
      );
      for (let index = 0; index < pending.length; index++) {
        const spec = pending[index];
        const row: Row = {
          gutter: gutterCells[index],
          content: contentCells[index],
          spec,
        };
        rows.set(spec.key, row);
        this.#keys.set(row.content, spec.key);
        changed.add(spec.key);
      }
      pending = [];
    };

    for (const spec of specs) {
      while (cursor != null && !nextKeys.has(this.#keyOf(cursor))) {
        removeAtCursor();
      }
      const existing = rows.get(spec.key);
      if (existing == null) {
        pending.push(spec);
        continue;
      }
      flushPending();
      if (existing.content === cursor) {
        advance();
      } else {
        gutter.insertBefore(existing.gutter, gutterCursor);
        content.insertBefore(existing.content, cursor);
      }
      const previous = existing.spec;
      if (previous?.content !== spec.content) {
        const patched = patchCell(
          existing.content,
          previous?.content,
          spec.content
        );
        if (patched !== existing.content) {
          existing.content = patched;
          this.#keys.set(patched, spec.key);
        }
        changed.add(spec.key);
      }
      if (previous?.gutter !== spec.gutter) {
        existing.gutter = patchCell(
          existing.gutter,
          previous?.gutter,
          spec.gutter
        );
        changed.add(spec.key);
      }
      existing.spec = spec;
    }
    flushPending();
    while (cursor != null) {
      removeAtCursor();
    }
    return { changed };
  }

  // Builds the key map from the specs the columns were last written from.
  #index(): void {
    const unindexed = this.#unindexed;
    if (unindexed == null) return;
    this.#unindexed = undefined;
    const { specs, trusted } = unindexed;
    let gutterCell = this.#gutter.firstElementChild;
    let contentCell = this.#content.firstElementChild;
    for (const spec of specs) {
      if (
        !(gutterCell instanceof HTMLElement) ||
        !(contentCell instanceof HTMLElement)
      ) {
        throw new Error(
          'ColumnReconciler: the columns have fewer rows than their specs'
        );
      }
      this.#rows.set(spec.key, {
        gutter: gutterCell,
        content: contentCell,
        spec: trusted ? spec : undefined,
      });
      this.#keys.set(contentCell, spec.key);
      gutterCell = gutterCell.nextElementSibling;
      contentCell = contentCell.nextElementSibling;
    }
    if (gutterCell != null || contentCell != null) {
      throw new Error(
        'ColumnReconciler: the columns have more rows than their specs'
      );
    }
  }

  #keyOf(element: Element | null): RowKey {
    const key = element == null ? undefined : this.#keys.get(element);
    if (key == null) {
      throw new Error('ColumnReconciler: a row on screen has no key');
    }
    return key;
  }
}

// Inserts cells before `cursor` (at the end when it is null) as one HTML
// string, and returns the elements they parsed to, in order.
function insertRun(
  parent: HTMLElement,
  cursor: Element | null,
  cells: readonly HASTElement[]
): HTMLElement[] {
  const before =
    cursor == null ? parent.lastElementChild : cursor.previousElementSibling;
  const html = hastToHtml([...cells]);
  if (cursor == null) {
    parent.insertAdjacentHTML('beforeend', html);
  } else {
    cursor.insertAdjacentHTML('beforebegin', html);
  }
  const elements: HTMLElement[] = new Array(cells.length);
  let node =
    cursor == null ? parent.lastElementChild : cursor.previousElementSibling;
  for (let index = cells.length - 1; index >= 0; index--) {
    if (!(node instanceof HTMLElement)) {
      throw new Error(
        'ColumnReconciler: a row cell did not parse to an element'
      );
    }
    elements[index] = node;
    node = node.previousElementSibling;
  }
  if (node !== before) {
    throw new Error(
      'ColumnReconciler: a row cell did not parse to one element'
    );
  }
  return elements;
}

// Brings a cell in line with its next spec and returns the element that
// shows it: the same element with what differs rewritten (attributes
// always, children only when the next spec does not share the last one's
// children array), or a new element when the tag changed, since a tag
// cannot change in place.
function patchCell(
  element: HTMLElement,
  previous: HASTElement | undefined,
  next: HASTElement
): HTMLElement {
  if (element.tagName.toLowerCase() !== next.tagName.toLowerCase()) {
    element.insertAdjacentHTML('beforebegin', hastToHtml(next));
    const replacement = element.previousElementSibling;
    element.remove();
    if (!(replacement instanceof HTMLElement)) {
      throw new Error(
        'ColumnReconciler: a row cell did not parse to an element'
      );
    }
    return replacement;
  }
  if (previous == null || !patchAttributes(element, previous, next)) {
    syncAttributes(element, next);
  }
  if (previous == null || previous.children !== next.children) {
    element.innerHTML = hastToHtml(next.children);
  }
  return element;
}

// Sets only the attributes that changed for the given element. Returns false
// for a property it cannot serialize itself, and the caller parses instead.
function patchAttributes(
  element: HTMLElement,
  previous: HASTElement,
  next: HASTElement
): boolean {
  const nextNames = new Set<string>();
  for (const key in next.properties) {
    const attribute = attributeFor(key, next.properties[key]);
    if (attribute === undefined) {
      return false;
    }
    if (attribute === null) {
      continue;
    }
    nextNames.add(attribute.name);
    if (element.getAttribute(attribute.name) !== attribute.value) {
      element.setAttribute(attribute.name, attribute.value);
    }
  }
  for (const key in previous.properties) {
    const attribute = attributeFor(key, previous.properties[key]);
    if (attribute === undefined) {
      return false;
    }
    if (attribute != null && !nextNames.has(attribute.name)) {
      element.removeAttribute(attribute.name);
    }
  }
  return true;
}

// Serializes the cell, parses it, and copies the attributes over. Slower, but
// always matches what a freshly written row gets.
function syncAttributes(element: HTMLElement, next: HASTElement): void {
  const template = document.createElement('template');
  template.innerHTML = hastToHtml({ ...next, children: [] });
  const target = template.content.firstElementChild;
  if (target == null) {
    throw new Error('ColumnReconciler: a row cell did not parse to an element');
  }
  for (const name of element.getAttributeNames()) {
    if (!target.hasAttribute(name)) {
      element.removeAttribute(name);
    }
  }
  for (const name of target.getAttributeNames()) {
    const value = target.getAttribute(name) ?? '';
    if (element.getAttribute(name) !== value) {
      element.setAttribute(name, value);
    }
  }
}
