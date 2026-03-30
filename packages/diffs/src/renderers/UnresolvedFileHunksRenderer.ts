import type { Element as HASTElement, Properties } from 'hast';

import { DEFAULT_RENDER_RANGE, DEFAULT_THEMES } from '../constants';
import type {
  FileDiffMetadata,
  MergeConflictMarkerRow,
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
  type DiffHunksRendererOptions,
  type DiffHunksRendererOptionsWithDefaults,
  type HunksRenderResult,
  type InjectedRow,
  type LineDecoration,
  type RenderedLineContext,
  type SplitLineDecorationProps,
  type UnifiedInjectedRowPlacement,
  type UnifiedLineDecorationProps,
} from './DiffHunksRenderer';

type MergeConflictMarkerType =
  | 'marker-start'
  | 'marker-base'
  | 'marker-separator'
  | 'marker-end'
  | 'current'
  | 'incoming';

interface MergeConflictActionRowData {
  hunkIndex: number;
  lineIndex: number;
  conflictIndex: number;
}

interface MergeConflictMarkerInjectedRow extends MergeConflictMarkerRow {
  type: Extract<
    MergeConflictMarkerRow['type'],
    'marker-start' | 'marker-base' | 'marker-separator' | 'marker-end'
  >;
  lineText: string;
  lineIndex: number;
}

// NOTE(amadeus): Don't love this, should probably rework into an
// interface/extender
type MergeConflictInjectedRowData =
  | ({ type: 'actions' } & MergeConflictActionRowData)
  | MergeConflictMarkerInjectedRow;

interface BaseUnresolvedOptionsWithDefaults extends DiffHunksRendererOptionsWithDefaults {
  mergeConflictActionsType: MergeConflictActionsType;
}

type MergeConflictActionsType = 'none' | 'default' | 'custom';

export interface UnresolvedFileHunksRendererOptions extends DiffHunksRendererOptions {
  mergeConflictActionsType?: MergeConflictActionsType;
}

export class UnresolvedFileHunksRenderer<
  LAnnotation = undefined,
> extends DiffHunksRenderer<LAnnotation> {
  private pendingConflictActions: (MergeConflictDiffAction | undefined)[] = [];
  private pendingMarkerRows: MergeConflictMarkerRow[] = [];
  private injectedRows = new Map<string, MergeConflictInjectedRowData[]>();
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

  // SELF_REVIEW: I don't love how this is hooked up with `renderDiff` right
  // now, so we definitely need to figure out what the fuck we are gonna do
  // about it...
  // I think at the very least we should keep it like annotations, and just
  // sorta assume there's a disconnect there
  public setConflictState(
    conflictActions: (MergeConflictDiffAction | undefined)[],
    markerRows: MergeConflictMarkerRow[],
    diff: FileDiffMetadata
  ): void {
    this.pendingConflictActions = conflictActions;
    this.pendingMarkerRows = markerRows;
    this.syncInjectedRows(conflictActions, markerRows, diff);
  }

  private syncInjectedRows(
    conflictActions: (MergeConflictDiffAction | undefined)[],
    markerRows: MergeConflictMarkerRow[],
    diff: FileDiffMetadata
  ): void {
    this.injectedRows.clear();
    for (const action of conflictActions) {
      const anchor =
        action != null ? getMergeConflictActionAnchor(action, diff) : undefined;
      if (action == null || anchor == null) {
        continue;
      }
      const row: MergeConflictInjectedRowData = {
        type: 'actions',
        hunkIndex: anchor.hunkIndex,
        lineIndex: anchor.lineIndex,
        conflictIndex: action.conflictIndex,
      };
      this.addInjectedRow(row);
    }

    for (const row of markerRows) {
      this.addInjectedRow(row);
    }
  }

  private addInjectedRow(row: MergeConflictInjectedRowData): void {
    const key = `${row.hunkIndex}:${row.lineIndex}`;
    const rows = this.injectedRows.get(key);
    if (rows == null) {
      this.injectedRows.set(key, [row]);
    } else {
      rows.push(row);
    }
  }

  public override renderDiff(
    diff?: FileDiffMetadata | undefined,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): HunksRenderResult | undefined {
    if (diff != null) {
      this.syncInjectedRows(
        this.pendingConflictActions,
        this.pendingMarkerRows,
        diff
      );
    }
    return super.renderDiff(diff, renderRange);
  }

  public override async asyncRender(
    diff: FileDiffMetadata,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): Promise<HunksRenderResult> {
    this.syncInjectedRows(
      this.pendingConflictActions,
      this.pendingMarkerRows,
      diff
    );
    return super.asyncRender(diff, renderRange);
  }

  protected override createPreElement(
    split: boolean,
    totalLines: number
  ): HASTElement {
    return super.createPreElement(split, totalLines, {
      'data-has-merge-conflict': '',
    });
  }

  protected override getUnifiedLineDecoration({
    type,
    lineType,
  }: UnifiedLineDecorationProps): LineDecoration {
    const mergeConflictType =
      type === 'change'
        ? lineType === 'change-deletion'
          ? 'current'
          : 'incoming'
        : undefined;
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
  }: SplitLineDecorationProps): LineDecoration {
    const mergeConflictType =
      type === 'change'
        ? side === 'deletions'
          ? 'current'
          : 'incoming'
        : undefined;
    return {
      gutterLineType: type === 'change' ? 'context' : type,
      gutterProperties: getMergeConflictGutterProperties(mergeConflictType),
      contentProperties: getMergeConflictContentProperties(
        type,
        mergeConflictType
      ),
    };
  }

  protected override getUnifiedInjectedRowsForLine = (
    ctx: RenderedLineContext
  ): UnifiedInjectedRowPlacement | undefined => {
    const rows = this.injectedRows.get(`${ctx.hunkIndex}:${ctx.lineIndex}`);
    if (rows == null || rows.length === 0) {
      return undefined;
    }
    const { mergeConflictActionsType } = this.getOptionsWithDefaults();
    const before: InjectedRow[] = [];
    const after: InjectedRow[] = [];
    for (const row of rows) {
      if (row.type === 'actions') {
        before.push({
          content: createMergeConflictActionsRowElement({
            row,
            includeDefaultActions: mergeConflictActionsType === 'default',
            includeSlot: true,
          }),
          gutter: createMergeConflictGutterGap('action'),
        });
        continue;
      }
      const target = row.type === 'marker-end' ? after : before;
      target.push({
        content: createMergeConflictMarkerRowElement(row),
        gutter: createMergeConflictGutterGap('marker', row.type),
      });
    }
    return {
      before: before.length > 0 ? before : undefined,
      after: after.length > 0 ? after : undefined,
    };
  };

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

function createMergeConflictGutterGap(
  type: 'action' | 'marker',
  markerType?: MergeConflictMarkerInjectedRow['type']
): HASTElement {
  const gap = createGutterGap(undefined, 'annotation', 1);
  gap.properties['data-gutter-buffer'] =
    type === 'action'
      ? 'merge-conflict-action'
      : `merge-conflict-${markerType ?? 'marker'}`;
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
            hunkIndex: row.hunkIndex,
            lineIndex: row.lineIndex,
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

function createMergeConflictMarkerRowElement(
  row: MergeConflictMarkerInjectedRow
): HASTElement {
  return createHastElement({
    tagName: 'div',
    properties: {
      'data-merge-conflict': row.type,
      'data-merge-conflict-marker-row': '',
    },
    children: [
      createTextNodeElement(row.lineText.replace(/(?:\r\n|\n|\r)$/, '')),
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
