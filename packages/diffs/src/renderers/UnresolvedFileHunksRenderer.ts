import type { ElementContent, Element as HASTElement } from 'hast';

import { DEFAULT_RENDER_RANGE } from '../constants';
import type {
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

interface MergeConflictActionRowData {
  side: DiffLineAnnotation<undefined>['side'];
  lineNumber: number;
  conflictIndex: number;
  lineIndex: number;
  rowKey: string;
  slotName: string;
  sourceIndex: number;
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
  private mergeConflictActionAnnotations: DiffLineAnnotation<MergeConflictActionAnnotationMetadata>[] =
    [];
  private additionMarkerLookup: MergeConflictMarkerLookup[] = [];
  private deletionMarkerLookup: MergeConflictMarkerLookup[] = [];
  private renderDefaultMergeConflictActions = true;

  public setRenderDefaultMergeConflictActions(enabled: boolean): void {
    this.renderDefaultMergeConflictActions = enabled;
  }

  public setMergeConflictActionAnnotations(
    lineAnnotations: DiffLineAnnotation<MergeConflictActionAnnotationMetadata>[]
  ): void {
    this.mergeConflictActionAnnotations = lineAnnotations;
  }

  public override renderDiff(
    diff: FileDiffMetadata | undefined = undefined,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): HunksRenderResult | undefined {
    if (diff != null) {
      this.prepareMarkerLookups(diff);
    }
    const result = super.renderDiff(diff, renderRange);
    return this.injectMergeConflictActionRows(result);
  }

  public override async asyncRender(
    diff: FileDiffMetadata,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): Promise<HunksRenderResult> {
    this.prepareMarkerLookups(diff);
    const result = await super.asyncRender(diff, renderRange);
    return this.injectMergeConflictActionRows(result) ?? result;
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

  private injectMergeConflictActionRows(
    result: HunksRenderResult | undefined
  ): HunksRenderResult | undefined {
    if (result == null || this.mergeConflictActionAnnotations.length === 0) {
      return result;
    }
    const actionRows = this.buildActionRows();
    if (actionRows.length === 0) {
      return result;
    }
    const insertedRows =
      result.unifiedContentAST != null
        ? this.injectUnifiedMergeConflictActionRows(result, actionRows)
        : this.injectSplitMergeConflictActionRows(result, actionRows);
    if (insertedRows > 0) {
      result.rowCount += insertedRows;
    }
    return result;
  }

  private buildActionRows(): MergeConflictActionRowData[] {
    const rows: MergeConflictActionRowData[] = [];
    for (
      let sourceIndex = 0;
      sourceIndex < this.mergeConflictActionAnnotations.length;
      sourceIndex++
    ) {
      const annotation = this.mergeConflictActionAnnotations[sourceIndex];
      const conflictIndex = annotation.metadata.conflict.conflictIndex;
      rows.push({
        side: annotation.side,
        lineNumber: annotation.lineNumber,
        conflictIndex,
        lineIndex: annotation.metadata.lineIndex,
        rowKey: `${conflictIndex},${annotation.metadata.lineIndex}`,
        slotName: getMergeConflictActionSlotName({
          side: annotation.side,
          lineNumber: annotation.lineNumber,
          conflictIndex,
        }),
        sourceIndex,
      });
    }
    return rows;
  }

  private injectUnifiedMergeConflictActionRows(
    result: HunksRenderResult,
    actionRows: MergeConflictActionRowData[]
  ): number {
    const { unifiedContentAST, unifiedGutterAST } = result;
    if (unifiedContentAST == null || unifiedGutterAST == null) {
      return 0;
    }
    const insertionBySideAndLine =
      buildUnifiedLineInsertionIndexMap(unifiedContentAST);
    const targets = [];
    for (const row of actionRows) {
      const insertionIndex = insertionBySideAndLine.get(
        `${row.side}:${row.lineNumber}`
      );
      if (insertionIndex == null) {
        continue;
      }
      targets.push({ row, insertionIndex, sourceIndex: row.sourceIndex });
    }
    targets.sort((a, b) => {
      if (a.insertionIndex !== b.insertionIndex) {
        return b.insertionIndex - a.insertionIndex;
      }
      return b.sourceIndex - a.sourceIndex;
    });
    for (const { row, insertionIndex } of targets) {
      unifiedContentAST.splice(
        insertionIndex,
        0,
        createMergeConflictActionsRowElement({
          row,
          includeDefaultActions: this.renderDefaultMergeConflictActions,
          includeSlot: true,
        })
      );
      unifiedGutterAST.splice(
        insertionIndex,
        0,
        createMergeConflictGutterGap()
      );
    }
    return targets.length;
  }

  private injectSplitMergeConflictActionRows(
    result: HunksRenderResult,
    actionRows: MergeConflictActionRowData[]
  ): number {
    const {
      additionsContentAST,
      additionsGutterAST,
      deletionsContentAST,
      deletionsGutterAST,
    } = result;
    if (
      additionsContentAST == null ||
      additionsGutterAST == null ||
      deletionsContentAST == null ||
      deletionsGutterAST == null
    ) {
      return 0;
    }
    const additionsInsertionByLine =
      buildSplitLineInsertionIndexMap(additionsContentAST);
    const deletionsInsertionByLine =
      buildSplitLineInsertionIndexMap(deletionsContentAST);
    const targets = [];
    for (const row of actionRows) {
      const insertionIndex =
        row.side === 'additions'
          ? additionsInsertionByLine.get(row.lineNumber)
          : deletionsInsertionByLine.get(row.lineNumber);
      if (insertionIndex == null) {
        continue;
      }
      targets.push({ row, insertionIndex, sourceIndex: row.sourceIndex });
    }
    targets.sort((a, b) => {
      if (a.insertionIndex !== b.insertionIndex) {
        return b.insertionIndex - a.insertionIndex;
      }
      return b.sourceIndex - a.sourceIndex;
    });
    for (const { row, insertionIndex } of targets) {
      const isAdditionTarget = row.side === 'additions';
      const targetContentAST = isAdditionTarget
        ? additionsContentAST
        : deletionsContentAST;
      const targetGutterAST = isAdditionTarget
        ? additionsGutterAST
        : deletionsGutterAST;
      const otherContentAST = isAdditionTarget
        ? deletionsContentAST
        : additionsContentAST;
      const otherGutterAST = isAdditionTarget
        ? deletionsGutterAST
        : additionsGutterAST;
      targetContentAST.splice(
        insertionIndex,
        0,
        createMergeConflictActionsRowElement({
          row,
          includeDefaultActions: this.renderDefaultMergeConflictActions,
          includeSlot: true,
        })
      );
      targetGutterAST.splice(insertionIndex, 0, createMergeConflictGutterGap());
      otherContentAST.splice(
        insertionIndex,
        0,
        createMergeConflictActionsRowElement({
          row,
          includeDefaultActions: false,
          includeSlot: false,
        })
      );
      otherGutterAST.splice(insertionIndex, 0, createMergeConflictGutterGap());
    }
    return targets.length;
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

function buildSplitLineInsertionIndexMap(
  rows: ElementContent[]
): Map<number, number> {
  const map = new Map<number, number>();
  let currentLineNumber: number | undefined;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!isHastElement(row)) {
      continue;
    }
    const lineNumber = getNumericProperty(row, 'data-line');
    if (lineNumber != null) {
      currentLineNumber = lineNumber;
      map.set(lineNumber, index + 1);
      continue;
    }
    if (
      currentLineNumber != null &&
      isInlineMetadataRow(row) &&
      !hasNoNewlineMetadata(row)
    ) {
      map.set(currentLineNumber, index + 1);
      continue;
    }
    currentLineNumber = undefined;
  }
  return map;
}

function buildUnifiedLineInsertionIndexMap(
  rows: ElementContent[]
): Map<string, number> {
  const map = new Map<string, number>();
  let currentKey: string | undefined;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!isHastElement(row)) {
      continue;
    }
    const lineNumber = getNumericProperty(row, 'data-line');
    const side = getUnifiedRowSide(row);
    if (lineNumber != null && side != null) {
      currentKey = `${side}:${lineNumber}`;
      map.set(currentKey, index + 1);
      continue;
    }
    if (
      currentKey != null &&
      isInlineMetadataRow(row) &&
      !hasNoNewlineMetadata(row)
    ) {
      map.set(currentKey, index + 1);
      continue;
    }
    currentKey = undefined;
  }
  return map;
}

function getUnifiedRowSide(
  row: HASTElement
): DiffLineAnnotation<undefined>['side'] | undefined {
  const lineType = getStringProperty(row, 'data-line-type');
  if (lineType == null) {
    return undefined;
  }
  if (lineType === 'change-deletion') {
    return 'deletions';
  }
  return 'additions';
}

function isInlineMetadataRow(row: HASTElement): boolean {
  const properties = row.properties;
  return (
    properties != null &&
    ('data-line-annotation' in properties ||
      'data-merge-conflict-actions' in properties)
  );
}

function hasNoNewlineMetadata(row: HASTElement): boolean {
  return row.properties != null && 'data-no-newline' in row.properties;
}

function isHastElement(node: ElementContent): node is HASTElement {
  return node.type === 'element';
}

function getStringProperty(row: HASTElement, key: string): string | undefined {
  const value = row.properties?.[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return `${value}`;
  }
  return undefined;
}

function getNumericProperty(row: HASTElement, key: string): number | undefined {
  const value = row.properties?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
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
  const contentChildren: HASTElement[] = [];
  if (includeDefaultActions) {
    contentChildren.push(createMergeConflictActionsContent(row));
  }
  if (includeSlot) {
    contentChildren.push(
      createHastElement({
        tagName: 'slot',
        properties: { name: row.slotName },
      })
    );
  }
  return createHastElement({
    tagName: 'div',
    properties: {
      'data-merge-conflict-actions': row.rowKey,
      'data-merge-conflict-actions-empty':
        !includeDefaultActions && !includeSlot ? '' : undefined,
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
  row: Pick<MergeConflictActionRowData, 'conflictIndex' | 'lineIndex'>
): HASTElement {
  const { conflictIndex, lineIndex } = row;
  return createHastElement({
    tagName: 'div',
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
