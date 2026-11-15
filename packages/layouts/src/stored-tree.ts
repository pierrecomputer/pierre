import type { LayoutTreeOperation } from './layout-operation';
import { validateLayout } from './model';
import type {
  ChildSize,
  Direction,
  Edge,
  LayoutNode,
  PaneNode,
  SplitNode,
  StackNode,
  StoredLayoutTree,
} from './types';

/**
 * A tree or a list of operations from storage or from a client that does not
 * have a valid form. `path` names the field, for example `tree.root.sizes[1]`.
 */
export class InvalidLayoutTreeError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'InvalidLayoutTreeError';
    this.path = path;
  }
}

const TREE_KEYS = new Set(['version', 'root']);
const PANE_KEYS = new Set([
  'type',
  'id',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'hidden',
  'collapsed',
  'collapsedSize',
]);
const STACK_KEYS = new Set([
  'type',
  'id',
  'children',
  'active',
  'collapsed',
  'collapsedSize',
]);
const SPLIT_KEYS = new Set(['type', 'id', 'direction', 'children', 'sizes']);

type Fields = Readonly<Record<string, unknown>>;

function fieldsOf(value: unknown, path: string, keys: Set<string>): Fields {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new InvalidLayoutTreeError(path, 'must be an object');
  for (const key of Object.keys(value)) {
    if (!keys.has(key))
      throw new InvalidLayoutTreeError(`${path}.${key}`, 'is not allowed');
  }
  return value as Fields;
}

function stringAt(fields: Fields, key: string, path: string): string {
  const value = fields[key];
  if (typeof value !== 'string' || value.length === 0)
    throw new InvalidLayoutTreeError(
      `${path}.${key}`,
      'must be a non-empty string'
    );
  return value;
}

function optionalNumber(
  fields: Fields,
  key: string,
  path: string
): number | undefined {
  const value = fields[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new InvalidLayoutTreeError(
      `${path}.${key}`,
      'must be a finite number of 0 or more'
    );
  return value;
}

function optionalBoolean(
  fields: Fields,
  key: string,
  path: string
): boolean | undefined {
  const value = fields[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean')
    throw new InvalidLayoutTreeError(`${path}.${key}`, 'must be a boolean');
  return value;
}

function arrayAt(fields: Fields, key: string, path: string): unknown[] {
  const value = fields[key];
  if (!Array.isArray(value))
    throw new InvalidLayoutTreeError(`${path}.${key}`, 'must be an array');
  return value;
}

function withDefined<T extends object>(node: T): T {
  return Object.fromEntries(
    Object.entries(node).filter(([, value]) => value !== undefined)
  ) as T;
}

function parsePane(value: unknown, path: string): PaneNode {
  const fields = fieldsOf(value, path, PANE_KEYS);
  return withDefined<PaneNode>({
    type: 'pane',
    id: stringAt(fields, 'id', path),
    minWidth: optionalNumber(fields, 'minWidth', path),
    minHeight: optionalNumber(fields, 'minHeight', path),
    maxWidth: optionalNumber(fields, 'maxWidth', path),
    maxHeight: optionalNumber(fields, 'maxHeight', path),
    hidden: optionalBoolean(fields, 'hidden', path),
    collapsed: optionalBoolean(fields, 'collapsed', path),
    collapsedSize: optionalNumber(fields, 'collapsedSize', path),
  });
}

function parseStack(value: unknown, path: string): StackNode {
  const fields = fieldsOf(value, path, STACK_KEYS);
  const children = arrayAt(fields, 'children', path).map((child, index) => {
    const childPath = `${path}.children[${index}]`;
    if (child === null || typeof child !== 'object' || Array.isArray(child))
      throw new InvalidLayoutTreeError(childPath, 'must be an object');
    if ((child as Fields).type !== 'pane')
      throw new InvalidLayoutTreeError(
        `${childPath}.type`,
        'a stack holds panes only'
      );
    return parsePane(child, childPath);
  });
  return withDefined<StackNode>({
    type: 'stack',
    id: stringAt(fields, 'id', path),
    children,
    active: stringAt(fields, 'active', path),
    collapsed: optionalBoolean(fields, 'collapsed', path),
    collapsedSize: optionalNumber(fields, 'collapsedSize', path),
  });
}

function parseSize(value: unknown, path: string): ChildSize {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0)
      throw new InvalidLayoutTreeError(path, 'must be a positive weight');
    return value;
  }
  const fields = fieldsOf(value, path, new Set(['px']));
  const px = fields.px;
  if (typeof px !== 'number' || !Number.isFinite(px) || px < 0)
    throw new InvalidLayoutTreeError(
      `${path}.px`,
      'must be a finite number of 0 or more'
    );
  return { px };
}

function parseDirection(fields: Fields, path: string): Direction {
  const direction = fields.direction;
  if (direction !== 'horizontal' && direction !== 'vertical')
    throw new InvalidLayoutTreeError(
      `${path}.direction`,
      'must be "horizontal" or "vertical"'
    );
  return direction;
}

function parseSplit(value: unknown, path: string): SplitNode {
  const fields = fieldsOf(value, path, SPLIT_KEYS);
  return {
    type: 'split',
    id: stringAt(fields, 'id', path),
    direction: parseDirection(fields, path),
    children: arrayAt(fields, 'children', path).map((child, index) =>
      parseNode(child, `${path}.children[${index}]`)
    ),
    sizes: arrayAt(fields, 'sizes', path).map((size, index) =>
      parseSize(size, `${path}.sizes[${index}]`)
    ),
  };
}

function parseNode(value: unknown, path: string): LayoutNode {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new InvalidLayoutTreeError(path, 'must be an object');
  const type = (value as Fields).type;
  if (type === 'pane') return parsePane(value, path);
  if (type === 'stack') return parseStack(value, path);
  if (type === 'split') return parseSplit(value, path);
  throw new InvalidLayoutTreeError(
    `${path}.type`,
    'must be "pane", "stack", or "split"'
  );
}

/**
 * Validate the saved form of a layout, `{ version: 3, root }`, read from
 * storage or from a client. It checks the core shape of the tree: the fields
 * of each node, unique IDs, and one size for each child. A store gives the
 * tree the shape of its model when it takes it.
 */
export function parseStoredLayoutTree(value: unknown): StoredLayoutTree {
  const fields = fieldsOf(value, 'tree', TREE_KEYS);
  if (fields.version !== 3)
    throw new InvalidLayoutTreeError('tree.version', 'must be 3');
  const root = parseNode(fields.root, 'tree.root');
  try {
    validateLayout(root);
  } catch (error) {
    throw new InvalidLayoutTreeError(
      'tree.root',
      error instanceof Error ? error.message : String(error)
    );
  }
  return { version: 3, root };
}

// The fields of each tree operation, besides `type`.
const OPERATION_KEYS: Readonly<Record<LayoutTreeOperation['type'], string>> = {
  setRoot: 'root',
  resize: 'sizes',
  collapse: 'pane collapsed',
  split: 'target pane edge id',
  close: 'pane',
  move: 'pane target edge id',
  swap: 'panes',
  activate: 'pane',
  addTab: 'target pane index activate id',
  moveToStack: 'pane target index activate id',
  moveTab: 'pane index',
  hide: 'pane hidden',
};

const EDGES: ReadonlySet<unknown> = new Set(['left', 'right', 'top', 'bottom']);

function booleanAt(fields: Fields, key: string, path: string): boolean {
  const value = optionalBoolean(fields, key, path);
  if (value === undefined)
    throw new InvalidLayoutTreeError(`${path}.${key}`, 'must be a boolean');
  return value;
}

function indexAt(
  fields: Fields,
  key: string,
  path: string
): number | undefined {
  const value = fields[key];
  if (
    value !== undefined &&
    (!Number.isInteger(value) || (value as number) < 0)
  )
    throw new InvalidLayoutTreeError(
      `${path}.${key}`,
      'must be an integer of 0 or more'
    );
  return value as number | undefined;
}

function edgeAt(fields: Fields, path: string): Edge {
  if (!EDGES.has(fields.edge))
    throw new InvalidLayoutTreeError(
      `${path}.edge`,
      'must be "left", "right", "top", or "bottom"'
    );
  return fields.edge as Edge;
}

function paneAt(fields: Fields, path: string): PaneNode {
  const value = fields.pane;
  if ((value as Fields | null)?.type !== 'pane')
    throw new InvalidLayoutTreeError(`${path}.pane.type`, 'must be "pane"');
  return parsePane(value, `${path}.pane`);
}

function optionalId(fields: Fields, path: string): string | undefined {
  return fields.id === undefined ? undefined : stringAt(fields, 'id', path);
}

function parseSizes(
  value: unknown,
  path: string
): Readonly<Record<string, readonly ChildSize[]>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new InvalidLayoutTreeError(path, 'must be an object');
  return Object.fromEntries(
    Object.entries(value).map(([id, sizes]) => {
      const at = `${path}.${id}`;
      if (!Array.isArray(sizes))
        throw new InvalidLayoutTreeError(at, 'must be an array');
      return [
        id,
        sizes.map((size, index) => parseSize(size, `${at}[${index}]`)),
      ];
    })
  );
}

function parseOperation(value: unknown, path: string): LayoutTreeOperation {
  const type = (value as Fields | null)?.type;
  if (typeof type !== 'string' || !Object.hasOwn(OPERATION_KEYS, type))
    throw new InvalidLayoutTreeError(
      `${path}.type`,
      'must be the type of a tree operation'
    );
  const name = type as LayoutTreeOperation['type'];
  const fields = fieldsOf(
    value,
    path,
    new Set(['type', ...OPERATION_KEYS[name].split(' ')])
  );
  const pane = (): string => stringAt(fields, 'pane', path);
  const target = (): string => stringAt(fields, 'target', path);
  switch (name) {
    case 'setRoot':
      return { type: name, root: parseNode(fields.root, `${path}.root`) };
    case 'resize':
      return { type: name, sizes: parseSizes(fields.sizes, `${path}.sizes`) };
    case 'collapse':
      return {
        type: name,
        pane: pane(),
        collapsed: booleanAt(fields, 'collapsed', path),
      };
    case 'split':
      return withDefined({
        type: name,
        target: target(),
        pane: paneAt(fields, path),
        edge: edgeAt(fields, path),
        id: optionalId(fields, path),
      });
    case 'move':
      return withDefined({
        type: name,
        pane: pane(),
        target: target(),
        edge: edgeAt(fields, path),
        id: optionalId(fields, path),
      });
    case 'swap': {
      const panes = arrayAt(fields, 'panes', path);
      if (
        panes.length !== 2 ||
        !panes.every((id) => typeof id === 'string' && id.length > 0)
      )
        throw new InvalidLayoutTreeError(
          `${path}.panes`,
          'must hold 2 pane IDs'
        );
      return { type: name, panes: [panes[0] as string, panes[1] as string] };
    }
    case 'addTab':
      return withDefined({
        type: name,
        target: target(),
        pane: paneAt(fields, path),
        index: indexAt(fields, 'index', path),
        activate: booleanAt(fields, 'activate', path),
        id: optionalId(fields, path),
      });
    case 'moveToStack':
      return withDefined({
        type: name,
        pane: pane(),
        target: target(),
        index: indexAt(fields, 'index', path),
        activate: booleanAt(fields, 'activate', path),
        id: optionalId(fields, path),
      });
    case 'moveTab': {
      const index = indexAt(fields, 'index', path);
      if (index === undefined)
        throw new InvalidLayoutTreeError(
          `${path}.index`,
          'must be an integer of 0 or more'
        );
      return { type: name, pane: pane(), index };
    }
    case 'hide':
      return {
        type: name,
        pane: pane(),
        hidden: booleanAt(fields, 'hidden', path),
      };
    default:
      return { type: name, pane: pane() };
  }
}

/**
 * Validate tree operations from a client, for a server, before
 * `applyLayoutOperations`. An error names the path of the field, for example
 * `operations[2].edge`. The parser checks the form only; the fold checks the
 * operations against the tree.
 */
export function parseLayoutOperations(value: unknown): LayoutTreeOperation[] {
  if (!Array.isArray(value))
    throw new InvalidLayoutTreeError('operations', 'must be an array');
  return value.map((operation, index) =>
    parseOperation(operation, `operations[${index}]`)
  );
}
