/**
 * The UI realm's controls. It never touches the document: it receives the
 * selected layer's text from the sandbox, hands it to Shiki (see highlight.ts),
 * and sends the resulting character ranges back for binding.
 */
import type { HighlighterCore } from '@shikijs/core';

import type { MapTokensResult } from '../shared/mapTokens';
import type {
  CollectionSummary,
  SandboxMessage,
  SelectionSummary,
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
  target: requireElement<HTMLParagraphElement>('target'),
  language: requireElement<HTMLSelectElement>('language'),
  collection: requireElement<HTMLSelectElement>('collection'),
  status: requireElement<HTMLParagraphElement>('status'),
  apply: requireElement<HTMLButtonElement>('apply'),
  cancel: requireElement<HTMLButtonElement>('cancel'),
};

/** What the picker opens on, since the full list is alphabetical. */
const DEFAULT_LANGUAGE = 'typescript';

let collections: CollectionSummary[] = [];
let selection: SelectionSummary | null = null;
/** Kept from the last run so the sandbox's report can be summarized with it. */
let lastMapping: MapTokensResult | null = null;

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
 * Rebuilds the collection picker, keeping the user's choice if that collection
 * still exists and otherwise defaulting to the collection holding the most
 * `syntax/*` variables — the semantic collection, whatever it was named at
 * import time.
 */
function fillCollections(): void {
  const previous = elements.collection.value;
  elements.collection.replaceChildren();

  for (const collection of collections) {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = `${collection.name} (${collection.modeNames.join(', ')})`;
    elements.collection.append(option);
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

function render(issue: string | null): void {
  const hasSyntaxVariables = collections.some(
    (collection) => collection.syntaxVariableCount > 0
  );

  elements.collection.disabled = collections.length === 0;
  elements.apply.disabled = selection === null || collections.length === 0;

  if (selection !== null) {
    elements.target.textContent = `Selected: ${selection.nodeName}`;
    elements.target.dataset.issue = 'false';
  } else {
    elements.target.textContent =
      issue ?? 'Select a text layer containing code.';
    elements.target.dataset.issue = 'true';
  }

  if (collections.length === 0) {
    setStatus(
      'This file has no local variable collections. Import the Pierre tokens first.',
      'error'
    );
  } else if (!hasSyntaxVariables) {
    setStatus(
      'No collection has syntax/* variables. Import packages/theme/figma/semantic into this file.',
      'error'
    );
  } else if (lastMapping === null) {
    // Clears an environment warning that no longer holds, without wiping the
    // summary from a run that already happened.
    setStatus('');
  }
}

/** Tokenizes the selected layer and asks the sandbox to bind the result. */
async function apply(): Promise<void> {
  const target = selection;
  const collectionId = elements.collection.value;
  if (target === null || collectionId === '') return;

  elements.apply.disabled = true;
  setStatus('Tokenizing…');

  try {
    const highlighter = await highlighterReady;
    const mapping = await highlightToBindings(
      highlighter,
      target.characters,
      elements.language.value
    );
    lastMapping = mapping;

    if (mapping.bindings.length === 0) {
      setStatus('Nothing to bind: no token matched a Pierre role.', 'error');
      elements.apply.disabled = false;
      return;
    }

    setStatus(`Binding ${String(mapping.bindings.length)} ranges…`);
    post({
      type: 'apply',
      nodeId: target.nodeId,
      collectionId,
      bindings: mapping.bindings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Highlighting failed: ${message}`, 'error');
    elements.apply.disabled = false;
  }
}

function summarize(boundRanges: number, missingVariableNames: string[]): void {
  const lines = [`Bound ${String(boundRanges)} ranges.`];

  if (lastMapping !== null && lastMapping.unmatchedRanges > 0) {
    lines.push(
      `Left ${String(lastMapping.unmatchedRanges)} ranges alone (colors with no Pierre role: ${lastMapping.unmatchedColors.join(', ')}).`
    );
  }
  if (missingVariableNames.length > 0) {
    lines.push(
      `Missing from the chosen collection: ${missingVariableNames.join(', ')}.`
    );
  }

  setStatus(
    lines.join('\n'),
    missingVariableNames.length > 0 ? 'error' : 'info'
  );
}

function handleMessage(message: SandboxMessage): void {
  switch (message.type) {
    case 'state':
      collections = message.collections;
      selection = message.selection;
      fillCollections();
      render(message.issue);
      return;
    case 'applied':
      elements.apply.disabled = false;
      summarize(message.boundRanges, message.missingVariableNames);
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
