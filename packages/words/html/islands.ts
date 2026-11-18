import { escapeHtml } from '../lib/utils';
import type {
  HtmlIsland,
  HtmlOptions,
  IslandData,
  IslandPending,
} from './types';

export const islandSelector = '[data-words-island]';

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
  pending: IslandPending | undefined
): string {
  if (pending === undefined || pending === '') return '';
  const open = '<div data-markdown="island-pending"';
  if (typeof pending === 'string')
    return open + ' role="status">' + escapeHtml(pending) + '</div>';
  const accessibility = pending.label
    ? ' role="status" aria-label="' + escapeHtml(pending.label) + '"'
    : ' aria-hidden="true"';
  return (
    open +
    ' class="' +
    escapeHtml(pending.className) +
    '"' +
    accessibility +
    '></div>'
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
  // JSON encoding preserves ids that contain line breaks or control characters.
  const key = escapeHtml(JSON.stringify(data.id));
  return (
    '<div data-words-island="' +
    escapeHtml(name) +
    '" data-words-island-id="' +
    key +
    '" data-words-island-data="' +
    escapeHtml(code) +
    '">' +
    '<div data-words-island-content></div>' +
    '<div data-words-island-fallback>' +
    escapeHtml(island.fallback ?? 'Interactive content') +
    '</div></div>'
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

export function isIsland(node: Node | null): node is HTMLElement {
  return (
    node?.nodeType === 1 && (node as Element).hasAttribute('data-words-island')
  );
}

/** Resolve hosts in document order and move portal targets only if an island moved. */
export function collectIslands(
  root: HTMLElement,
  previous: readonly MountedIsland[]
): readonly MountedIsland[] {
  const next: MountedIsland[] = [];
  const old = new Map(previous.map((island) => [island.key, island]));
  const seen = new Set<string>();
  const enclosingIsland = root.closest(islandSelector);
  for (const host of root.querySelectorAll<HTMLElement>(islandSelector)) {
    // Ignore descendants owned by an island, including nested Markdown renderers.
    if (host.parentElement?.closest(islandSelector) !== enclosingIsland)
      continue;
    if (host.closest('[data-markdown="root"]') !== root) continue;
    const name = host.dataset.wordsIsland!;
    const key = host.dataset.wordsIslandId!;
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
    const prior = existing?.name === name ? existing : undefined;
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
