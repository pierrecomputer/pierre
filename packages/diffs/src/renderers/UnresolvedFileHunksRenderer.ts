import type { Element as HASTElement } from 'hast';

import { DEFAULT_RENDER_RANGE } from '../constants';
import type {
  AnnotationSpan,
  DiffLineAnnotation,
  FileDiffMetadata,
  MergeConflictResolution,
  RenderRange,
} from '../types';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { createHastElement, createTextNodeElement } from '../utils/hast_utils';
import type { MergeConflictActionAnnotationMetadata } from '../utils/parseMergeConflictDiffFromFile';
import {
  DiffHunksRenderer,
  type HunksRenderResult,
  type LineDecoration,
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

interface MergeConflictActionSlotData {
  conflictIndex: number;
  lineIndex: number;
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
  private additionMarkerLookup: MergeConflictMarkerLookup[] = [];
  private deletionMarkerLookup: MergeConflictMarkerLookup[] = [];
  private renderDefaultMergeConflictActions = true;
  private mergeConflictActionSlotData = new Map<
    string,
    MergeConflictActionSlotData
  >();

  public setRenderDefaultMergeConflictActions(enabled: boolean): void {
    this.renderDefaultMergeConflictActions = enabled;
  }

  public override setLineAnnotations(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[]
  ): void {
    this.mergeConflictActionSlotData.clear();
    for (const annotation of lineAnnotations) {
      const metadata = (annotation as { metadata?: unknown }).metadata;
      if (!isMergeConflictActionMetadata(metadata)) {
        continue;
      }
      this.mergeConflictActionSlotData.set(getLineAnnotationName(annotation), {
        conflictIndex: metadata.conflict.conflictIndex,
        lineIndex: metadata.lineIndex,
      });
    }
    super.setLineAnnotations(lineAnnotations);
  }

  public override renderDiff(
    diff: FileDiffMetadata | undefined = undefined,
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
    const pre = super.createPreElement(
      split,
      totalLines,
      themeStyles,
      baseThemeType
    );
    pre.properties['data-merge-conflict-action-style-override'] = '';
    return pre;
  }

  protected override createAnnotationElement(
    span: AnnotationSpan
  ): HASTElement {
    const contentChildren: HASTElement[] = [];
    for (const slotName of span.annotations) {
      const actionData = this.mergeConflictActionSlotData.get(slotName);
      if (actionData != null && this.renderDefaultMergeConflictActions) {
        contentChildren.push(createMergeConflictActionsContent(actionData));
      }
      contentChildren.push(
        createHastElement({
          tagName: 'slot',
          properties: { name: slotName },
        })
      );
    }
    return createHastElement({
      tagName: 'div',
      children: [
        createHastElement({
          tagName: 'div',
          properties: { 'data-annotation-content': '' },
          children: contentChildren,
        }),
      ],
      properties: {
        'data-line-annotation': `${span.hunkIndex},${span.lineIndex}`,
      },
    });
  }

  protected override getUnifiedLineDecoration({
    type,
    lineType,
    additionLineIndex,
    deletionLineIndex,
    additionLineRaw,
    deletionLineRaw,
  }: UnifiedLineDecorationProps): LineDecoration {
    const mergeConflictType =
      type === 'change'
        ? lineType === 'change-deletion'
          ? 'current'
          : 'incoming'
        : (this.getMergeConflictMarkerTypeAtIndex(
            'additions',
            additionLineIndex,
            additionLineRaw
          ) ??
          this.getMergeConflictMarkerTypeAtIndex(
            'deletions',
            deletionLineIndex,
            deletionLineRaw
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
    lineRaw,
  }: SplitLineDecorationProps): LineDecoration {
    const mergeConflictType =
      type === 'change'
        ? side === 'deletions'
          ? 'current'
          : 'incoming'
        : this.getMergeConflictMarkerTypeAtIndex(side, lineIndex, lineRaw);
    return {
      gutterLineType: type === 'change' ? 'context' : type,
      gutterProperties: getMergeConflictGutterProperties(mergeConflictType),
      contentProperties: getMergeConflictContentProperties(
        type,
        mergeConflictType
      ),
    };
  }

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
    lineIndex: number | undefined,
    lineRaw: string | undefined
  ): MergeConflictMarkerType | undefined {
    if (lineIndex == null) {
      return getMergeConflictMarkerType(lineRaw);
    }
    const lookup =
      side === 'additions'
        ? this.additionMarkerLookup
        : this.deletionMarkerLookup;
    const value = lookup[lineIndex];
    if (value == null) {
      return getMergeConflictMarkerType(lineRaw);
    }
    return value === 'none' ? undefined : value;
  }
}

function getMergeConflictGutterProperties(
  mergeConflictType: MergeConflictMarkerType | undefined
): { 'data-merge-conflict': MergeConflictMarkerType } | undefined {
  if (mergeConflictType == null) {
    return undefined;
  }
  return { 'data-merge-conflict': mergeConflictType };
}

function getMergeConflictContentProperties(
  type: 'change' | 'context' | 'context-expanded',
  mergeConflictType: MergeConflictMarkerType | undefined
):
  | {
      'data-line-type'?: 'context';
      'data-merge-conflict'?: MergeConflictMarkerType;
    }
  | undefined {
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

function isMergeConflictActionMetadata(
  metadata: unknown
): metadata is MergeConflictActionAnnotationMetadata {
  return (
    typeof metadata === 'object' &&
    metadata != null &&
    'type' in metadata &&
    metadata.type === 'merge-conflict-action' &&
    'conflict' in metadata &&
    typeof metadata.conflict === 'object' &&
    metadata.conflict != null &&
    'lineIndex' in metadata &&
    typeof metadata.lineIndex === 'number'
  );
}

function createMergeConflictActionsContent({
  conflictIndex,
  lineIndex,
}: MergeConflictActionSlotData): HASTElement {
  return createHastElement({
    tagName: 'div',
    properties: { 'data-merge-conflict-actions-content': '' },
    children: [
      createMergeConflictActionButton({
        resolution: 'current',
        label: 'Accept current change',
        conflictIndex,
        lineIndex,
      }),
      createMergeConflictActionSeparator(),
      createMergeConflictActionButton({
        resolution: 'incoming',
        label: 'Accept incoming change',
        conflictIndex,
        lineIndex,
      }),
      createMergeConflictActionSeparator(),
      createMergeConflictActionButton({
        resolution: 'both',
        label: 'Accept both',
        conflictIndex,
        lineIndex,
      }),
    ],
  });
}

interface CreateMergeConflictActionButtonProps {
  resolution: MergeConflictResolution;
  label: string;
  conflictIndex: number;
  lineIndex: number;
}

function createMergeConflictActionButton({
  resolution,
  label,
  conflictIndex,
  lineIndex,
}: CreateMergeConflictActionButtonProps): HASTElement {
  return createHastElement({
    tagName: 'button',
    properties: {
      type: 'button',
      'data-merge-conflict-action': resolution,
      'data-merge-conflict-conflict-index': `${conflictIndex}`,
      'data-merge-conflict-line-index': `${lineIndex}`,
    },
    children: [createTextNodeElement(label)],
  });
}

function createMergeConflictActionSeparator(): HASTElement {
  return createHastElement({
    tagName: 'span',
    properties: { 'data-merge-conflict-action-separator': '' },
    children: [createTextNodeElement('\u2009|\u2009')],
  });
}
