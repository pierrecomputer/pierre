import type { Element as HASTElement, Properties } from 'hast';

import { DEFAULT_RENDER_RANGE, DEFAULT_THEMES } from '../constants';
import type {
  BaseDiffOptions,
  BaseDiffOptionsWithDefaults,
  DiffLineAnnotation,
  FileDiffMetadata,
  MergeConflictResolution,
  RenderRange,
} from '../types';
import { getMergeConflictActionSlotName } from '../utils/getMergeConflictActionSlotName';
import {
  createGutterGap,
  createHastElement,
  createTextNodeElement,
} from '../utils/hast_utils';
import {
  getMergeConflictActionAnchor,
  type MergeConflictDiffAction,
} from '../utils/parseMergeConflictDiffFromFile';
import type { WorkerPoolManager } from '../worker';
import {
  DiffHunksRenderer,
  type HunksRenderResult,
  type InlineRow,
  type LineDecoration,
  type RenderedLineContext,
  type SplitLineDecorationProps,
  type UnifiedLineDecorationProps,
} from './DiffHunksRenderer';

type MergeConflictMarkerType =
  | 'marker-start'
  | 'marker-base'
  | 'marker-separator'
  | 'marker-end'
  | 'current'
  | 'incoming';
type MergeConflictMarkerLookup = MergeConflictMarkerType | 'none';

interface MergeConflictActionRowData {
  side: DiffLineAnnotation<undefined>['side'];
  lineNumber: number;
  conflictIndex: number;
}

interface BaseUnresolvedOptionsWithDefaults extends BaseDiffOptionsWithDefaults {
  mergeConflictActionsType: MergeConflictActionsType;
}

type MergeConflictActionsType = 'none' | 'default' | 'custom';

export interface UnresolvedFileHunksRendererOptions extends BaseDiffOptions {
  mergeConflictActionsType?: MergeConflictActionsType;
}

const START_MARKER = /^<{7,}(?:\s.*)?$/;
const BASE_MARKER = /^\|{7,}(?:\s.*)?$/;
const SEPARATOR_MARKER = /^={7,}(?:\s.*)?$/;
const END_MARKER = /^>{7,}(?:\s.*)?$/;

export class UnresolvedFileHunksRenderer<
  LAnnotation = undefined,
> extends DiffHunksRenderer<LAnnotation> {
  private cachedAdditionLines: string[] | undefined;
  private cachedDeletionLines: string[] | undefined;
  private conflictActions = new Map<string, MergeConflictActionRowData[]>();
  private additionMarkerLookup: MergeConflictMarkerLookup[] = [];
  private deletionMarkerLookup: MergeConflictMarkerLookup[] = [];
  public override options: UnresolvedFileHunksRendererOptions;

  constructor(
    options: UnresolvedFileHunksRendererOptions = {
      theme: DEFAULT_THEMES,
    },
    onRenderUpdate?: () => unknown,
    workerManager?: WorkerPoolManager | undefined
  ) {
    super(undefined, onRenderUpdate, workerManager);
    this.options = options;
  }

  public setConflictActions(conflictActions: MergeConflictDiffAction[]): void {
    this.conflictActions.clear();
    for (const action of conflictActions) {
      const anchor = getMergeConflictActionAnchor(action);
      if (anchor == null) {
        continue;
      }
      const row = {
        side: anchor.side,
        lineNumber: anchor.lineNumber,
        conflictIndex: action.conflictIndex,
      };
      const key = `${row.side}:${row.lineNumber}`;
      const rows = this.conflictActions.get(key);
      if (rows == null) {
        this.conflictActions.set(key, [row]);
      } else {
        rows.push(row);
      }
    }
  }

  public override renderDiff(
    diff?: FileDiffMetadata | undefined,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): HunksRenderResult | undefined {
    if (diff != null) {
      this.prepareMarkerLookups(diff);
    }
    return super.renderDiff(diff, renderRange);
  }

  public override async asyncRender(
    diff: FileDiffMetadata,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): Promise<HunksRenderResult> {
    this.prepareMarkerLookups(diff);
    return super.asyncRender(diff, renderRange);
  }

  protected override createPreElement(
    split: boolean,
    totalLines: number,
    themeStyles: string,
    baseThemeType: 'light' | 'dark' | undefined
  ): HASTElement {
    return super.createPreElement(
      split,
      totalLines,
      themeStyles,
      baseThemeType,
      { 'data-has-merge-conflict': '' }
    );
  }

  protected override getUnifiedLineDecoration({
    type,
    lineType,
    additionLineIndex,
    deletionLineIndex,
  }: UnifiedLineDecorationProps): LineDecoration {
    const mergeConflictType =
      type === 'change'
        ? lineType === 'change-deletion'
          ? 'current'
          : 'incoming'
        : (this.getMergeConflictMarkerTypeAtIndex(
            'additions',
            additionLineIndex
          ) ??
          this.getMergeConflictMarkerTypeAtIndex(
            'deletions',
            deletionLineIndex
          ));
    return {
      gutterLineType: type === 'change' ? 'context' : lineType,
      gutterProperties: getMergeConflictGutterProperties(mergeConflictType),
      contentProperties: getMergeConflictContentProperties(
        type,
        mergeConflictType
      ),
    };
  }

  protected override getSplitLineDecoration({
    side,
    type,
    lineIndex,
  }: SplitLineDecorationProps): LineDecoration {
    const mergeConflictType =
      type === 'change'
        ? side === 'deletions'
          ? 'current'
          : 'incoming'
        : this.getMergeConflictMarkerTypeAtIndex(side, lineIndex);
    return {
      gutterLineType: type === 'change' ? 'context' : type,
      gutterProperties: getMergeConflictGutterProperties(mergeConflictType),
      contentProperties: getMergeConflictContentProperties(
        type,
        mergeConflictType
      ),
    };
  }

  protected override getUnifiedInlineRowsForLine = (
    ctx: RenderedLineContext
  ): InlineRow[] | undefined => {
    const side = getUnifiedRenderedSide(ctx);
    const lineNumber =
      side === 'deletions'
        ? ctx.deletionLine?.lineNumber
        : ctx.additionLine?.lineNumber;
    if (lineNumber == null) {
      return undefined;
    }
    const rows = this.conflictActions.get(`${side}:${lineNumber}`);
    if (rows == null || rows.length === 0) {
      return undefined;
    }
    const { mergeConflictActionsType } = this.getOptionsWithDefaults();
    return rows.map((row) => ({
      content: createMergeConflictActionsRowElement({
        row,
        includeDefaultActions: mergeConflictActionsType === 'default',
        includeSlot: true,
      }),
      gutter: createMergeConflictGutterGap(),
    }));
  };

  private prepareMarkerLookups(diff: FileDiffMetadata): void {
    if (this.cachedAdditionLines !== diff.additionLines) {
      this.cachedAdditionLines = diff.additionLines;
      this.additionMarkerLookup = buildMarkerLookup(diff.additionLines);
    }
    if (this.cachedDeletionLines !== diff.deletionLines) {
      this.cachedDeletionLines = diff.deletionLines;
      this.deletionMarkerLookup = buildMarkerLookup(diff.deletionLines);
    }
  }

  private getMergeConflictMarkerTypeAtIndex(
    side: 'additions' | 'deletions',
    lineIndex: number | undefined
  ): MergeConflictMarkerType | undefined {
    if (lineIndex == null) {
      return undefined;
    }
    const value = (
      side === 'additions'
        ? this.additionMarkerLookup
        : this.deletionMarkerLookup
    )[lineIndex];
    if (value == null) {
      return undefined;
    }
    return value === 'none' ? undefined : value;
  }

  protected override getOptionsWithDefaults(): BaseUnresolvedOptionsWithDefaults {
    const options = super.getOptionsWithDefaults();
    options.diffStyle = 'unified';
    options.lineDiffType = 'none';
    // NOTE(amadeus): Aint nobody got time for a spread
    (options as BaseUnresolvedOptionsWithDefaults).mergeConflictActionsType =
      this.options.mergeConflictActionsType ?? 'default';
    return options as BaseUnresolvedOptionsWithDefaults;
  }
}

function getMergeConflictGutterProperties(
  mergeConflictType: MergeConflictMarkerType | undefined
): Properties | undefined {
  return mergeConflictType != null
    ? { 'data-merge-conflict': mergeConflictType }
    : undefined;
}

function getMergeConflictContentProperties(
  type: 'change' | 'context' | 'context-expanded',
  mergeConflictType: MergeConflictMarkerType | undefined
): Properties | undefined {
  if (mergeConflictType == null) {
    return undefined;
  }
  if (type === 'change') {
    if (mergeConflictType === 'current' || mergeConflictType === 'incoming') {
      return {
        'data-line-type': 'context',
        'data-merge-conflict': mergeConflictType,
      };
    }
    return undefined;
  }
  if (
    mergeConflictType === 'marker-start' ||
    mergeConflictType === 'marker-base' ||
    mergeConflictType === 'marker-separator' ||
    mergeConflictType === 'marker-end'
  ) {
    return { 'data-merge-conflict': mergeConflictType };
  }
  return undefined;
}

function getMergeConflictMarkerType(
  line: string | undefined
): MergeConflictMarkerType | undefined {
  if (line == null) {
    return undefined;
  }
  const trimmed = line.replace(/(?:\r\n|\n|\r)$/, '');
  if (START_MARKER.test(trimmed)) return 'marker-start';
  if (BASE_MARKER.test(trimmed)) return 'marker-base';
  if (SEPARATOR_MARKER.test(trimmed)) return 'marker-separator';
  if (END_MARKER.test(trimmed)) return 'marker-end';
  return undefined;
}

function buildMarkerLookup(lines: string[]): MergeConflictMarkerLookup[] {
  const markerLookup: MergeConflictMarkerLookup[] = new Array(lines.length);
  for (let index = 0; index < lines.length; index++) {
    markerLookup[index] = getMergeConflictMarkerType(lines[index]) ?? 'none';
  }
  return markerLookup;
}

function getUnifiedRenderedSide(
  ctx: RenderedLineContext
): DiffLineAnnotation<undefined>['side'] {
  if (
    ctx.type === 'change' &&
    ctx.deletionLine != null &&
    ctx.additionLine == null
  ) {
    return 'deletions';
  }
  return 'additions';
}

function createMergeConflictGutterGap(): HASTElement {
  const gap = createGutterGap(undefined, 'annotation', 1);
  gap.properties['data-gutter-buffer'] = 'merge-conflict-action';
  return gap;
}

interface CreateMergeConflictActionsRowElementProps {
  row: MergeConflictActionRowData;
  includeDefaultActions: boolean;
  includeSlot: boolean;
}

function createMergeConflictActionsRowElement({
  row,
  includeDefaultActions,
  includeSlot,
}: CreateMergeConflictActionsRowElementProps): HASTElement {
  const contentChildren: HASTElement[] = includeDefaultActions
    ? createMergeConflictActionsContent(row.conflictIndex)
    : [];
  if (includeSlot) {
    contentChildren.push(
      createHastElement({
        tagName: 'slot',
        properties: {
          name: getMergeConflictActionSlotName({
            side: row.side,
            lineNumber: row.lineNumber,
            conflictIndex: row.conflictIndex,
          }),
          'data-merge-conflict-action-slot': '',
        },
      })
    );
  }
  return createHastElement({
    tagName: 'div',
    properties: {
      'data-merge-conflict-actions': '',
    },
    children: [
      createHastElement({
        tagName: 'div',
        properties: { 'data-merge-conflict-actions-content': '' },
        children: contentChildren,
      }),
    ],
  });
}

function createMergeConflictActionsContent(
  conflictIndex: number
): HASTElement[] {
  return [
    createMergeConflictActionButton({
      resolution: 'current',
      label: 'Accept current change',
      conflictIndex,
    }),
    createMergeConflictActionSeparator(),
    createMergeConflictActionButton({
      resolution: 'incoming',
      label: 'Accept incoming change',
      conflictIndex,
    }),
    createMergeConflictActionSeparator(),
    createMergeConflictActionButton({
      resolution: 'both',
      label: 'Accept both',
      conflictIndex,
    }),
  ];
}

interface CreateMergeConflictActionButtonProps {
  resolution: MergeConflictResolution;
  label: string;
  conflictIndex: number;
}

function createMergeConflictActionButton({
  resolution,
  label,
  conflictIndex,
}: CreateMergeConflictActionButtonProps): HASTElement {
  return createHastElement({
    tagName: 'button',
    properties: {
      type: 'button',
      'data-merge-conflict-action': resolution,
      'data-merge-conflict-conflict-index': `${conflictIndex}`,
    },
    children: [createTextNodeElement(label)],
  });
}

function createMergeConflictActionSeparator(): HASTElement {
  return createHastElement({
    tagName: 'span',
    properties: { 'data-merge-conflict-action-separator': '' },
    children: [createTextNodeElement('|')],
  });
}
