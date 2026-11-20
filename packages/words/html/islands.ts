import { decodeHtml, escapeHtml } from '../lib/utils';
import type {
  HtmlIsland,
  HtmlOptions,
  IslandData,
  IslandPending,
} from './types';

const islandSelector = '[data-words-island]';
export const islandHostStart = ' data-words-island="';

function readIslandData(code: string): IslandData | undefined {
  let data: unknown;
  try {
    data = JSON.parse(code);
  } catch {
    return;
  }
  if (
    data !== null &&
    typeof data === 'object' &&
    Object.hasOwn(data, 'id') &&
    'id' in data &&
    typeof data.id === 'string' &&
    data.id.trim() !== ''
  )
    return data as IslandData;
  return undefined;
}

export function islandFor(
  islands: HtmlOptions['islands'],
  language: string
): HtmlIsland | undefined {
  const prefix = 'island-';
  if (islands === undefined || !language.startsWith(prefix)) return;
  const name = language.slice(prefix.length);
  return Object.hasOwn(islands, name) ? islands[name] : undefined;
}

/** Show an app-defined placeholder without reading the incomplete fence payload. */
export function formatIslandPending(
  pending: IslandPending | undefined,
  tag: 'div' | 'span' = 'div'
): string {
  if (pending === undefined || pending === '') return '';
  const open = `<${tag} data-markdown="island-pending"`;
  if (typeof pending === 'string')
    return open + ' role="status">' + escapeHtml(pending) + `</${tag}>`;
  const accessibility = pending.label
    ? ' role="status" aria-label="' + escapeHtml(pending.label) + '"'
    : ' aria-hidden="true"';
  return (
    open +
    ' class="' +
    escapeHtml(pending.className) +
    '"' +
    accessibility +
    `></${tag}>`
  );
}

/** Serialize the host for an accepted island, or keep the fence as code. */
export function formatIsland(
  island: HtmlIsland,
  language: string,
  code: string
): string | undefined {
  const name = language.slice('island-'.length);
  const data = readIslandData(code);
  if (data === undefined || !island.accepts(data)) return;
  return islandHost(
    'div',
    name,
    JSON.stringify(data.id),
    code,
    island.fallback ?? 'Interactive content'
  );
}

/** Serialize the same portal and fallback nodes for server and client rendering. */
function islandHost(
  tag: 'div' | 'span',
  name: string,
  key: string,
  code: string,
  fallback: string
): string {
  return (
    '<' +
    tag +
    islandHostStart +
    escapeHtml(name) +
    '" data-words-island-id="' +
    escapeHtml(key) +
    '" data-words-island-data="' +
    escapeHtml(code) +
    '">' +
    `<${tag} data-words-island-content></${tag}><${tag} data-words-island-fallback>` +
    escapeHtml(fallback) +
    `</${tag}></${tag}>`
  );
}

/** Pack the registry once so ordinary colons stay on the parser's literal path. */
export function inlineIslandNames(islands: HtmlOptions['islands']): string {
  let packed = '';
  for (const [name, definition] of Object.entries(islands ?? {})) {
    if (definition.inline !== true) continue;
    if (name.length > 255 || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name))
      throw new TypeError(`Invalid inline island name: ${name}`);
    packed += String.fromCharCode(name.length) + name;
  }
  return packed;
}

const punctuationEscape = /\\([!-/:-@[-`{-~])/g;
const attribute =
  /[ \t]*([A-Za-z_][\w-]*)(?:[ \t]*=[ \t]*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^\s"'={}`\\])+)))?(?=[ \t]|$)/y;

/** Expand only opaque spans identified by the inline parser. Labels are plain text. */
export function formatInlineIslands(
  html: string,
  islands: NonNullable<HtmlOptions['islands']>
): string {
  return html.replace(
    /<w-i ([lp])="([^"]*)">([^<]*)<\/w-i>/g,
    (_, kind: string, head: string, attrs: string) => {
      const open = head.indexOf('[');
      const name = head.slice(1, open);
      const raw = head + attrs;
      if (!Object.hasOwn(islands, name) || islands[name].inline !== true)
        return raw;
      const island = islands[name];
      if (kind === 'p') return formatIslandPending(island.pending, 'span');
      const label = decodeHtml(head.slice(open + 1, -1)).replace(
        punctuationEscape,
        '$1'
      );
      const fields: Record<string, string> = Object.create(null);
      const body = decodeHtml(attrs.slice(1, -1)).trim();
      let at = 0;
      while (at < body.length) {
        attribute.lastIndex = at;
        const match = attribute.exec(body);
        if (
          match === null ||
          match[1] === 'label' ||
          Object.hasOwn(fields, match[1])
        )
          return raw;
        fields[match[1]] = (match[2] ?? match[3] ?? match[4] ?? '').replace(
          punctuationEscape,
          '$1'
        );
        at = attribute.lastIndex;
      }
      if (fields.id?.trim() === '') return raw;
      const id = fields.id ?? JSON.stringify([name, label, fields]);
      const data = { ...fields, label, id };
      if (!island.accepts(data)) return raw;
      return islandHost(
        'span',
        name,
        fields.id === undefined ? id : JSON.stringify(id),
        JSON.stringify(data),
        island.fallback ?? label
      );
    }
  );
}

export interface MountedIsland {
  key: string;
  name: string;
  data: IslandData;
  content: HTMLElement;
  fallback: HTMLElement;
  source: string;
}

export const noIslands: readonly MountedIsland[] = [];

export function isIsland(node: Node | null): node is HTMLElement {
  return (
    node?.nodeType === 1 && (node as Element).hasAttribute('data-words-island')
  );
}

/** Collect hosts only from the top-level siblings just patched into the document. */
export function appendIslandHosts(
  hosts: HTMLElement[],
  first: Node | null,
  end: Node | null
): void {
  for (
    let node = first;
    node !== end && node !== null;
    node = node.nextSibling
  ) {
    if (node.nodeType !== 1) continue;
    if (isIsland(node)) {
      hosts.push(node);
      continue;
    }
    const nested = (node as Element).querySelectorAll<HTMLElement>(
      islandSelector
    );
    for (const host of nested) hosts.push(host);
  }
}

/** Resolve hosts in document order and move portal targets only if an island moved. */
export function collectIslands(
  root: HTMLElement,
  hosts: readonly HTMLElement[],
  previous: readonly MountedIsland[]
): readonly MountedIsland[] {
  const next: MountedIsland[] = [];
  const old = new Map(previous.map((island) => [island.key, island]));
  const seen = new Set<string>();
  const occurrences = new Map<string, number>();
  const enclosingIsland = root.closest(islandSelector);
  for (const host of hosts) {
    // Ignore descendants owned by an island, including nested Markdown renderers.
    if (host.parentElement?.closest(islandSelector) !== enclosingIsland)
      continue;
    if (host.closest('[data-markdown="root"]') !== root) continue;
    const name = host.dataset.wordsIsland!;
    let key = host.dataset.wordsIslandId;
    // Explicit ids are JSON strings. Identical anonymous directives are separate occurrences.
    if (key?.startsWith('[') === true) {
      const count = occurrences.get(key) ?? 0;
      occurrences.set(key, count + 1);
      key += ':' + count;
    }
    const source = host.dataset.wordsIslandData!;
    if (key === undefined || source === undefined || seen.has(key)) continue;
    let content = host.firstElementChild as HTMLElement | null;
    const fallback = host.lastElementChild as HTMLElement | null;
    if (
      content?.hasAttribute('data-words-island-content') !== true ||
      fallback?.hasAttribute('data-words-island-fallback') !== true
    )
      continue;
    const existing = old.get(key);
    const prior =
      existing?.name === name && existing.content.tagName === content.tagName
        ? existing
        : undefined;
    const data = source === prior?.source ? prior.data : readIslandData(source);
    if (data === undefined) continue;
    seen.add(key);
    if (prior !== undefined && prior.content !== content) {
      // Leave the old shell usable if it is still present as a duplicate.
      prior.content.replaceWith(content.cloneNode(false));
      content.replaceWith(prior.content);
      content = prior.content;
    }
    next.push(
      prior !== undefined &&
        prior.source === source &&
        prior.fallback === fallback
        ? prior
        : { key, name, data, content, fallback, source }
    );
  }
  return next.length === previous.length &&
    next.every((entry, at) => entry === previous[at])
    ? previous
    : next;
}
