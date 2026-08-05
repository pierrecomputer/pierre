/**
 * The UI realm's controls. It never touches the document: it receives the
 * selected layers' text from the sandbox, hands each one to Shiki (see
 * highlight.ts), and sends the resulting character ranges back for binding.
 */
import type { HighlighterCore } from '@shikijs/core';

import type {
  CollectionSummary,
  LayerBindings,
  SandboxMessage,
  SelectionLayer,
  UiMessage,
} from '../shared/messages';
import {
  createProbeHighlighter,
  highlightToBindings,
  LANGUAGES,
} from './highlight';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing #${id} in the plugin UI`);
  return element as T;
}

const elements = {
  notice: requireElement<HTMLParagraphElement>('notice'),
  language: requireElement<HTMLSelectElement>('language'),
  collection: requireElement<HTMLSelectElement>('collection'),
  status: requireElement<HTMLParagraphElement>('status'),
  apply: requireElement<HTMLButtonElement>('apply'),
  cancel: requireElement<HTMLButtonElement>('cancel'),
};

/** What the picker opens on, since the full list is alphabetical. */
const DEFAULT_LANGUAGE = 'typescript';

let collections: CollectionSummary[] = [];
let layers: SelectionLayer[] = [];

/** Totals from the last run, kept so the sandbox's report can cite them. */
let lastRun: { unmatchedRanges: number; unmatchedColors: string[] } | null =
  null;

/**
 * Created at startup, with no grammars registered yet — the picked language's
 * grammar is registered on demand inside `highlightToBindings`.
 */
const highlighterReady: Promise<HighlighterCore> = createProbeHighlighter();

function post(message: UiMessage): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

function setStatus(text: string, tone: 'info' | 'error' = 'info'): void {
  elements.status.textContent = text;
  elements.status.dataset.tone = tone;
}

/**
 * Fills the language picker with every language Shiki bundles, alphabetically.
 * The list is long, so the select relies on the browser's built-in type-ahead;
 * it opens on TypeScript rather than whatever sorts first.
 */
function fillLanguages(): void {
  for (const language of LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.id;
    option.textContent = language.label;
    elements.language.append(option);
  }

  const preferred = LANGUAGES.some(
    (language) => language.id === DEFAULT_LANGUAGE
  )
    ? DEFAULT_LANGUAGE
    : LANGUAGES[0]?.id;
  if (preferred !== undefined) elements.language.value = preferred;
}

/**
 * How a collection reads in the picker. The mode count is only worth showing
 * when there is more than one: a single-mode collection is fully described by
 * its name, and listing every mode of an eight-mode collection would overflow
 * the control. Library collections never report a count, since Figma's library
 * API does not expose their modes.
 */
function collectionLabel(collection: CollectionSummary): string {
  if (collection.modeNames.length < 2) return collection.name;
  return `${collection.name} (${String(collection.modeNames.length)} modes)`;
}

/**
 * Rebuilds the collection picker, keeping the user's choice if that collection
 * still exists and otherwise defaulting to the collection holding the most
 * `syntax/*` variables — the semantic collection, whatever it was named at
 * import time.
 *
 * Once a library is in play the options are grouped by where they come from,
 * because a library collection and a local one can easily share a name and the
 * two behave differently when bound.
 */
function fillCollections(): void {
  const previous = elements.collection.value;
  elements.collection.replaceChildren();

  const grouped = collections.some(
    (collection) => collection.source === 'library'
  );
  const groups = new Map<string, HTMLOptGroupElement>();
  const groupFor = (label: string): HTMLOptGroupElement => {
    const existing = groups.get(label);
    if (existing !== undefined) return existing;

    const group = document.createElement('optgroup');
    group.label = label;
    groups.set(label, group);
    elements.collection.append(group);
    return group;
  };

  for (const collection of collections) {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = collectionLabel(collection);

    if (!grouped) {
      elements.collection.append(option);
      continue;
    }
    groupFor(
      collection.source === 'library'
        ? (collection.libraryName ?? 'Library')
        : 'This file'
    ).append(option);
  }

  const stillPresent = collections.some(
    (collection) => collection.id === previous
  );
  if (stillPresent) {
    elements.collection.value = previous;
    return;
  }

  let best = collections[0];
  for (const collection of collections) {
    if (
      best !== undefined &&
      collection.syntaxVariableCount > best.syntaxVariableCount
    ) {
      best = collection;
    }
  }
  if (best !== undefined) elements.collection.value = best.id;
}

function render(issue: string | null, libraryIssue: string | null): void {
  const hasSyntaxVariables = collections.some(
    (collection) => collection.syntaxVariableCount > 0
  );

  elements.collection.disabled = collections.length === 0;
  elements.apply.disabled = layers.length === 0 || collections.length === 0;
  // The count lives on the button rather than in a separate line of text, so a
  // multi-layer run is legible right where it is about to be triggered.
  elements.apply.textContent =
    layers.length > 1
      ? `Highlight ${String(layers.length)} layers`
      : 'Highlight';

  // Shown only when there is nothing to work on; a usable selection needs no
  // narration.
  const notice =
    layers.length > 0 ? null : (issue ?? 'Select one or more text layers.');
  elements.notice.textContent = notice ?? '';
  elements.notice.hidden = notice === null;

  // A library that could not be read is worth saying out loud even when local
  // collections are usable, since it explains an absence the user is looking at.
  const warning =
    collections.length === 0
      ? 'No variable collections are available. Import the Pierre tokens, or enable the library that publishes them.'
      : hasSyntaxVariables
        ? libraryIssue
        : 'No collection has syntax/* variables. Import packages/theme/figma/semantic, or enable the library that publishes it.';

  if (warning !== null) {
    setStatus(warning, 'error');
  } else if (lastRun === null) {
    // Clears an environment warning that no longer holds, without wiping the
    // summary from a run that already happened.
    setStatus('');
  }
}

/**
 * Tokenizes every selected layer and asks the sandbox to bind the results.
 *
 * All layers are tokenized as the one language the picker names, which is the
 * point of allowing a multi-layer selection: several samples of the same
 * language get highlighted in one go. Layers are handled one after another
 * because they share a highlighter, and only the first pass has to register the
 * grammar.
 */
async function apply(): Promise<void> {
  const targets = layers;
  const collection = collections.find(
    (candidate) => candidate.id === elements.collection.value
  );
  if (targets.length === 0 || collection === undefined) return;

  elements.apply.disabled = true;
  setStatus('Tokenizing…');

  try {
    const highlighter = await highlighterReady;
    const lang = elements.language.value;

    const payload: LayerBindings[] = [];
    const unmatchedColors = new Set<string>();
    let unmatchedRanges = 0;
    let totalRanges = 0;

    for (const layer of targets) {
      const mapping = await highlightToBindings(
        highlighter,
        layer.characters,
        lang
      );

      unmatchedRanges += mapping.unmatchedRanges;
      for (const color of mapping.unmatchedColors) unmatchedColors.add(color);
      if (mapping.bindings.length === 0) continue;

      totalRanges += mapping.bindings.length;
      payload.push({
        nodeId: layer.nodeId,
        nodeName: layer.nodeName,
        bindings: mapping.bindings,
      });
    }

    lastRun = {
      unmatchedRanges,
      unmatchedColors: [...unmatchedColors].sort(),
    };

    if (payload.length === 0) {
      setStatus('Nothing to bind: no token matched a Pierre role.', 'error');
      elements.apply.disabled = false;
      return;
    }

    setStatus(`Binding ${String(totalRanges)} ranges…`);
    post({
      type: 'apply',
      collectionId: collection.id,
      collectionSource: collection.source,
      layers: payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Highlighting failed: ${message}`, 'error');
    elements.apply.disabled = false;
  }
}

function summarize(
  applied: Extract<SandboxMessage, { type: 'applied' }>
): void {
  const lines = [
    applied.boundLayers > 1
      ? `Bound ${String(applied.boundRanges)} ranges across ${String(applied.boundLayers)} layers.`
      : `Bound ${String(applied.boundRanges)} ranges.`,
  ];

  if (lastRun !== null && lastRun.unmatchedRanges > 0) {
    lines.push(
      `Left ${String(lastRun.unmatchedRanges)} ranges alone (colors with no Pierre role: ${lastRun.unmatchedColors.join(', ')}).`
    );
  }
  if (applied.missingVariableNames.length > 0) {
    lines.push(
      `Missing from the chosen collection: ${applied.missingVariableNames.join(', ')}.`
    );
  }
  if (applied.skippedLayers.length > 0) {
    const noun = applied.skippedLayers.length === 1 ? 'layer' : 'layers';
    lines.push(
      `Skipped ${String(applied.skippedLayers.length)} ${noun} (${applied.skippedLayers.join('; ')}).`
    );
  }

  const wentWrong =
    applied.missingVariableNames.length > 0 || applied.skippedLayers.length > 0;
  setStatus(lines.join('\n'), wentWrong ? 'error' : 'info');
}

function handleMessage(message: SandboxMessage): void {
  switch (message.type) {
    case 'state':
      collections = message.collections;
      layers = message.layers;
      fillCollections();
      render(message.issue, message.libraryIssue);
      return;
    case 'applied':
      elements.apply.disabled = false;
      summarize(message);
      return;
    case 'error':
      elements.apply.disabled = false;
      setStatus(message.message, 'error');
      return;
  }
}

fillLanguages();

elements.apply.addEventListener('click', () => {
  void apply();
});
elements.cancel.addEventListener('click', () => {
  post({ type: 'cancel' });
});

window.addEventListener('message', (event: MessageEvent) => {
  const message = (event.data as { pluginMessage?: SandboxMessage })
    .pluginMessage;
  if (message !== undefined) handleMessage(message);
});
