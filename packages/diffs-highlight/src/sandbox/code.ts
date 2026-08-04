/**
 * The sandbox realm. It owns the `figma` API — selection, variables, fonts — and
 * does no tokenizing: it hands the selected layer's text to the UI and applies
 * the character ranges the UI sends back.
 */
import type {
  CollectionSummary,
  SandboxMessage,
  SelectionSummary,
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
 * Describes the current selection for the UI, or explains why it cannot be
 * used. Only a single non-empty text layer is workable.
 */
function readSelection(): {
  selection: SelectionSummary | null;
  issue: string | null;
} {
  const nodes = figma.currentPage.selection;

  if (nodes.length === 0) {
    return { selection: null, issue: 'Select a text layer containing code.' };
  }
  if (nodes.length > 1) {
    return { selection: null, issue: 'Select a single text layer.' };
  }

  const node = nodes[0];
  if (node === undefined || node.type !== 'TEXT') {
    return {
      selection: null,
      issue: 'The selected layer is not a text layer.',
    };
  }
  if (node.characters.length === 0) {
    return { selection: null, issue: 'The selected text layer is empty.' };
  }

  return {
    selection: {
      nodeId: node.id,
      nodeName: node.name,
      characters: node.characters,
    },
    issue: null,
  };
}

/**
 * Lists every local collection with its modes, plus how many `syntax/*`
 * variables it holds. The semantic collection's name is chosen by whoever
 * imported the tokens, so that count is what lets the UI preselect the right
 * one instead of guessing from the name.
 */
async function readCollections(): Promise<CollectionSummary[]> {
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
    name: collection.name,
    modeNames: collection.modes.map((mode) => mode.name),
    syntaxVariableCount: syntaxCounts.get(collection.id) ?? 0,
  }));
}

async function sendState(): Promise<void> {
  const { selection, issue } = readSelection();
  post({
    type: 'state',
    collections: await readCollections(),
    selection,
    issue,
  });
}

/** Color variables of one collection, keyed by their full name. */
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

async function applyBindings(
  request: Extract<UiMessage, { type: 'apply' }>
): Promise<void> {
  const node = await figma.getNodeByIdAsync(request.nodeId);
  if (node === null || node.type !== 'TEXT') {
    post({ type: 'error', message: 'That text layer no longer exists.' });
    return;
  }

  // Bindings are ordered, so the last one's end is the highest offset needed.
  // Checking it once catches a layer edited between tokenizing and applying,
  // which would otherwise make every out-of-bounds range throw.
  const lastBinding = request.bindings[request.bindings.length - 1];
  if (lastBinding !== undefined && lastBinding.end > node.characters.length) {
    post({
      type: 'error',
      message: 'The text changed since it was tokenized. Run it again.',
    });
    return;
  }

  const variables = await readVariablesByName(request.collectionId);
  await loadFonts(node);

  const missingVariableNames = new Set<string>();
  let boundRanges = 0;

  for (const binding of request.bindings) {
    const variable = variables.get(binding.variableName);
    if (variable === undefined) {
      missingVariableNames.add(binding.variableName);
      continue;
    }
    bindRange(node, binding, variable);
    boundRanges += 1;
  }

  post({
    type: 'applied',
    boundRanges,
    missingVariableNames: [...missingVariableNames].sort(),
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
