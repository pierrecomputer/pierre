/**
 * The sandbox realm. It owns the `figma` API — selection, variables, fonts — and
 * does no tokenizing: it hands the selected layers' text to the UI and applies
 * the character ranges the UI sends back.
 *
 * Variables can come from this file or from a library enabled for it. The two
 * are reached through different APIs and only the local ones are bindable as
 * they are, which is what `resolveVariables` reconciles.
 */
import type {
  CollectionSummary,
  LayerBindings,
  SandboxMessage,
  SelectionLayer,
  TokenBinding,
  UiMessage,
} from '../shared/messages';

/** Variable-name prefix used to recognize a collection holding Pierre roles. */
const SYNTAX_PREFIX = 'syntax/';

figma.showUI(__html__, { width: 320, height: 320, themeColors: true });

function post(message: SandboxMessage): void {
  figma.ui.postMessage(message);
}

function postError(error: unknown): void {
  post({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Describes the selected text layers for the UI, or explains why there is
 * nothing to work on.
 *
 * Any number of text layers can be selected at once. Non-text layers and empty
 * text layers are filtered out rather than rejected, so a selection that sweeps
 * up a frame or a stray rectangle alongside the code still works.
 */
function readSelection(): {
  layers: SelectionLayer[];
  issue: string | null;
} {
  const nodes = figma.currentPage.selection;
  if (nodes.length === 0) {
    return { layers: [], issue: 'Select one or more text layers.' };
  }

  const textNodes = nodes.filter(
    (node): node is TextNode => node.type === 'TEXT'
  );
  if (textNodes.length === 0) {
    return { layers: [], issue: 'The selection has no text layers.' };
  }

  const layers = textNodes
    .filter((node) => node.characters.length > 0)
    .map((node) => ({
      nodeId: node.id,
      nodeName: node.name,
      characters: node.characters,
    }));

  if (layers.length === 0) {
    return {
      layers: [],
      issue:
        textNodes.length === 1
          ? 'The selected text layer is empty.'
          : 'The selected text layers are empty.',
    };
  }

  return { layers, issue: null };
}

/**
 * Lists every collection defined in this file, with its modes and how many
 * `syntax/*` variables it holds. The semantic collection's name is chosen by
 * whoever imported the tokens, so that count is what lets the UI preselect the
 * right one instead of guessing from the name.
 */
async function readLocalCollections(): Promise<CollectionSummary[]> {
  const [collections, variables] = await Promise.all([
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.variables.getLocalVariablesAsync('COLOR'),
  ]);

  const syntaxCounts = new Map<string, number>();
  for (const variable of variables) {
    if (!variable.name.startsWith(SYNTAX_PREFIX)) continue;
    const collectionId = variable.variableCollectionId;
    syntaxCounts.set(collectionId, (syntaxCounts.get(collectionId) ?? 0) + 1);
  }

  return collections.map((collection) => ({
    id: collection.id,
    source: 'local' as const,
    name: collection.name,
    modeNames: collection.modes.map((mode) => mode.name),
    syntaxVariableCount: syntaxCounts.get(collection.id) ?? 0,
  }));
}

/**
 * Collections published by the libraries enabled for this file, cached for as
 * long as the plugin stays open.
 *
 * Caching matters because reading them is not cheap: the `syntax/*` count is
 * only available by listing each collection's variables, so this costs a request
 * per collection, and `sendState` runs on every selection change. Nothing can go
 * stale in the meantime, since enabling a library happens in Figma's own UI,
 * which the plugin cannot do and cannot miss.
 */
let libraryCollectionsCache: {
  collections: CollectionSummary[];
  issue: string | null;
} | null = null;

async function readLibraryCollections(): Promise<{
  collections: CollectionSummary[];
  issue: string | null;
}> {
  if (libraryCollectionsCache !== null) return libraryCollectionsCache;

  // Feature-detected rather than assumed: the whole API is absent unless the
  // manifest asks for the `teamlibrary` permission.
  const teamLibrary: TeamLibraryAPI | undefined = figma.teamLibrary;
  if (teamLibrary === undefined) {
    libraryCollectionsCache = {
      collections: [],
      issue:
        'Library variables are unavailable: the plugin is missing the teamlibrary permission.',
    };
    return libraryCollectionsCache;
  }

  try {
    const published =
      await teamLibrary.getAvailableLibraryVariableCollectionsAsync();

    const collections = await Promise.all(
      published.map(async (collection): Promise<CollectionSummary> => {
        const variables =
          await teamLibrary.getVariablesInLibraryCollectionAsync(
            collection.key
          );
        return {
          id: collection.key,
          source: 'library' as const,
          name: collection.name,
          libraryName: collection.libraryName,
          modeNames: [],
          syntaxVariableCount: variables.filter(
            (variable) =>
              variable.resolvedType === 'COLOR' &&
              variable.name.startsWith(SYNTAX_PREFIX)
          ).length,
        };
      })
    );

    libraryCollectionsCache = { collections, issue: null };
  } catch (error) {
    // Reading rejects when the user cannot see one of the enabled libraries, so
    // the local collections are still worth offering.
    libraryCollectionsCache = {
      collections: [],
      issue: `Could not read library variables: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return libraryCollectionsCache;
}

async function sendState(): Promise<void> {
  const { layers, issue } = readSelection();
  const [local, library] = await Promise.all([
    readLocalCollections(),
    readLibraryCollections(),
  ]);

  post({
    type: 'state',
    collections: [...local, ...library.collections],
    layers,
    issue,
    libraryIssue: library.issue,
  });
}

/** Color variables of one local collection, keyed by their full name. */
async function readVariablesByName(
  collectionId: string
): Promise<Map<string, Variable>> {
  const variables = await figma.variables.getLocalVariablesAsync('COLOR');
  const byName = new Map<string, Variable>();
  for (const variable of variables) {
    if (variable.variableCollectionId === collectionId) {
      byName.set(variable.name, variable);
    }
  }
  return byName;
}

/**
 * Resolves every role name a run needs into a variable that can be bound.
 *
 * Names are gathered across all layers and resolved once each, which is what
 * makes a library collection affordable: a library's variables are not bindable
 * until they have been imported into this file, and that is one request apiece,
 * so a long sample still imports only the dozen or so roles it actually uses.
 * Importing is also what links the file to the library, so the variables show up
 * in the file afterwards and keep updating with it.
 */
async function resolveVariables(
  request: Extract<UiMessage, { type: 'apply' }>
): Promise<Map<string, Variable>> {
  const names = new Set<string>();
  for (const layer of request.layers) {
    for (const binding of layer.bindings) names.add(binding.variableName);
  }

  if (request.collectionSource === 'local') {
    const byName = await readVariablesByName(request.collectionId);
    const used = new Map<string, Variable>();
    for (const name of names) {
      const variable = byName.get(name);
      if (variable !== undefined) used.set(name, variable);
    }
    return used;
  }

  const published =
    await figma.teamLibrary.getVariablesInLibraryCollectionAsync(
      request.collectionId
    );
  const keysByName = new Map<string, string>();
  for (const variable of published) {
    if (variable.resolvedType === 'COLOR') {
      keysByName.set(variable.name, variable.key);
    }
  }

  const imported = await Promise.all(
    [...names].map(async (name) => {
      const key = keysByName.get(name);
      if (key === undefined) return null;
      return [
        name,
        await figma.variables.importVariableByKeyAsync(key),
      ] as const;
    })
  );

  return new Map(
    imported.filter(
      (entry): entry is NonNullable<typeof entry> => entry !== null
    )
  );
}

/** `setRangeFills` throws unless every font in the layer is loaded first. */
async function loadFonts(node: TextNode): Promise<void> {
  const fonts = node.getRangeAllFontNames(0, node.characters.length);
  await Promise.all(fonts.map((font) => figma.loadFontAsync(font)));
}

/**
 * Rewrites one character range's fill so its color comes from `variable`.
 *
 * The range's current solid paint is reused when there is one, which keeps
 * properties like opacity; a range with mixed or non-solid fills falls back to
 * an opaque paint, since the variable supplies the color either way.
 */
function bindRange(
  node: TextNode,
  binding: TokenBinding,
  variable: Variable
): void {
  const fills = node.getRangeFills(binding.start, binding.end);
  const existing =
    fills === figma.mixed
      ? undefined
      : fills.find((paint): paint is SolidPaint => paint.type === 'SOLID');

  const paint: SolidPaint = existing ?? {
    type: 'SOLID',
    color: { r: 0, g: 0, b: 0 },
  };

  node.setRangeFills(binding.start, binding.end, [
    figma.variables.setBoundVariableForPaint(paint, 'color', variable),
  ]);
}

/**
 * Applies one layer's ranges, or returns why it was skipped.
 *
 * A layer is skipped rather than failing the whole run, so one stale layer in a
 * multi-layer selection does not cost the user the others.
 */
async function applyToLayer(
  layer: LayerBindings,
  variables: Map<string, Variable>,
  missingVariableNames: Set<string>
): Promise<{ boundRanges: number } | { skipped: string }> {
  const node = await figma.getNodeByIdAsync(layer.nodeId);
  if (node === null || node.type !== 'TEXT') {
    return { skipped: `${layer.nodeName}: no longer exists` };
  }

  // Bindings are ordered, so the last one's end is the highest offset needed.
  // Checking it once catches a layer edited between tokenizing and applying,
  // which would otherwise make every out-of-bounds range throw.
  const lastBinding = layer.bindings[layer.bindings.length - 1];
  if (lastBinding !== undefined && lastBinding.end > node.characters.length) {
    return {
      skipped: `${layer.nodeName}: text changed since it was tokenized`,
    };
  }

  await loadFonts(node);

  let boundRanges = 0;
  for (const binding of layer.bindings) {
    const variable = variables.get(binding.variableName);
    if (variable === undefined) {
      missingVariableNames.add(binding.variableName);
      continue;
    }
    bindRange(node, binding, variable);
    boundRanges += 1;
  }

  return { boundRanges };
}

async function applyBindings(
  request: Extract<UiMessage, { type: 'apply' }>
): Promise<void> {
  const variables = await resolveVariables(request);
  const missingVariableNames = new Set<string>();
  const skippedLayers: string[] = [];
  let boundRanges = 0;
  let boundLayers = 0;

  for (const layer of request.layers) {
    const result = await applyToLayer(layer, variables, missingVariableNames);
    if ('skipped' in result) {
      skippedLayers.push(result.skipped);
      continue;
    }
    boundRanges += result.boundRanges;
    boundLayers += 1;
  }

  post({
    type: 'applied',
    boundRanges,
    boundLayers,
    missingVariableNames: [...missingVariableNames].sort(),
    skippedLayers,
  });
}

figma.ui.onmessage = (message: UiMessage) => {
  if (message.type === 'cancel') {
    figma.closePlugin();
    return;
  }
  applyBindings(message).catch(postError);
};

figma.on('selectionchange', () => {
  sendState().catch(postError);
});

sendState().catch(postError);
