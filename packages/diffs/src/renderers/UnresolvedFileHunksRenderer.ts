import type { ElementContent, Element as HASTElement } from 'hast';

import {
  type ContentDecorationProps,
  DiffHunksRenderer,
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

interface MergeConflictLineDecorationMetadata {
  mergeConflictType: MergeConflictMarkerType | undefined;
}

const START_MARKER = /^<{7,}(?:\s.*)?$/;
const BASE_MARKER = /^\|{7,}(?:\s.*)?$/;
const SEPARATOR_MARKER = /^={7,}(?:\s.*)?$/;
const END_MARKER = /^>{7,}(?:\s.*)?$/;

export class UnresolvedFileHunksRenderer<
  LAnnotation = undefined,
> extends DiffHunksRenderer<LAnnotation> {
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

  protected override getUnifiedLineDecoration({
    type,
    lineType,
    additionLineRaw,
    deletionLineRaw,
  }: UnifiedLineDecorationProps): LineDecoration {
    const mergeConflictType =
      type === 'change'
        ? lineType === 'change-deletion'
          ? 'current'
          : 'incoming'
        : (getMergeConflictMarkerType(additionLineRaw) ??
          getMergeConflictMarkerType(deletionLineRaw));
    return {
      gutterLineType: type === 'change' ? 'context' : lineType,
      gutterProperties: getMergeConflictGutterProperties(mergeConflictType),
      metadata: {
        mergeConflictType,
      } satisfies MergeConflictLineDecorationMetadata,
    };
  }

  protected override getSplitLineDecoration({
    side,
    type,
    lineRaw,
  }: SplitLineDecorationProps): LineDecoration {
    const mergeConflictType =
      type === 'change'
        ? side === 'deletions'
          ? 'current'
          : 'incoming'
        : getMergeConflictMarkerType(lineRaw);
    return {
      gutterLineType: type === 'change' ? 'context' : type,
      gutterProperties: getMergeConflictGutterProperties(mergeConflictType),
      metadata: {
        mergeConflictType,
      } satisfies MergeConflictLineDecorationMetadata,
    };
  }

  protected override decorateContentLine({
    lineNode,
    type,
    metadata,
  }: ContentDecorationProps): void {
    const mergeConflictType = getMergeConflictType(metadata);
    setMergeConflictAttribute(lineNode, type, mergeConflictType);
  }
}

function getMergeConflictType(
  metadata: unknown
): MergeConflictMarkerType | undefined {
  if (
    typeof metadata === 'object' &&
    metadata != null &&
    'mergeConflictType' in metadata
  ) {
    const value = metadata.mergeConflictType;
    if (
      value === 'marker-start' ||
      value === 'marker-base' ||
      value === 'marker-separator' ||
      value === 'marker-end' ||
      value === 'current' ||
      value === 'incoming'
    ) {
      return value;
    }
  }
  return undefined;
}

function getMergeConflictGutterProperties(
  mergeConflictType: MergeConflictMarkerType | undefined
): { 'data-merge-conflict': MergeConflictMarkerType } | undefined {
  if (mergeConflictType == null) {
    return undefined;
  }
  return { 'data-merge-conflict': mergeConflictType };
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

function setMergeConflictAttribute(
  node: ElementContent | undefined,
  lineType: 'change' | 'context' | 'context-expanded',
  mergeConflictType: MergeConflictMarkerType | undefined
): void {
  if (node == null || node.type !== 'element') {
    return;
  }
  if (mergeConflictType == null) {
    delete node.properties['data-merge-conflict'];
    return;
  }

  const isMarkerLine =
    mergeConflictType === 'marker-start' ||
    mergeConflictType === 'marker-base' ||
    mergeConflictType === 'marker-separator' ||
    mergeConflictType === 'marker-end';
  const isChangeLine =
    mergeConflictType === 'current' || mergeConflictType === 'incoming';

  if (
    (isMarkerLine &&
      lineType !== 'context' &&
      lineType !== 'context-expanded') ||
    (isChangeLine && lineType !== 'change')
  ) {
    delete node.properties['data-merge-conflict'];
    return;
  }
  if (isChangeLine) {
    node.properties['data-line-type'] = 'context';
  }
  node.properties['data-merge-conflict'] = mergeConflictType;
}
