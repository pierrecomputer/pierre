import type { Element as HASTElement } from 'hast';

import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  FileContents,
  FileDiffMetadata,
  Hunk,
  HunkExpansionRegion,
  HunkSeparators,
  RenderRange,
} from '../types';
import { areDiffTargetsEqual } from './areDiffTargetsEqual';
import { areFileTargetsEqual } from './areFileTargetsEqual';
import { createSeparator } from './createSeparator';
import { DEFAULT_EXPANSION_LINE_COUNT } from './expansionLineCount';
import { getHunkSideStartBoundary } from './getHunkSideBoundaries';
import { getModifiedLinesString } from './getModifiedLinesString';
import { createHastElement, createTextNodeElement } from './hast_utils';
import { iterateOverDiff } from './iterateOverDiff';
import { getTrailingContextRangeSize } from './virtualDiffLayout';

/**
 * A one-based, inclusive line range. For a diff it addresses new-file lines
 * (old-file lines for a deleted file, which has no new side).
 *
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export interface SnippetLineRange {
  start: number;
  end: number;
}

/**
 * A folded run of lines at the edge of a snippet, as handed to
 * `onSnippetExpand`.
 *
 * Every count on a snippet fold, and every `lineCount` a snippet takes or
 * reports (`expandSnippet`, `expansionLineCount`, `SnippetExpandEvent`), is in
 * source lines: an unchanged line counts once, a removed line and an added
 * line count once each. The fold's label shows the same number, and unified
 * and split agree on it. For a fold of unchanged lines this is the base
 * hunk separator's unit ("N unmodified lines").
 *
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export interface SnippetFold {
  /** Which side of the snippet's line range the fold sits on. */
  boundary: 'above' | 'below';
  /** Source lines currently hidden behind the fold (the label's count). */
  hiddenLines: number;
  /**
   * Added lines among `hiddenLines` (the fold's "+A" pill; 0 hides the pill).
   */
  hiddenAdditions: number;
  /**
   * Removed lines among `hiddenLines` (the fold's "-D" pill; 0 hides the
   * pill).
   */
  hiddenDeletions: number;
  /**
   * True when the hidden lines include an addition or deletion
   * (`hiddenAdditions + hiddenDeletions > 0`).
   */
  containsChanges: boolean;
  /**
   * The lines the fold hides, numbered like the snippet's `lineRange`, or
   * undefined when it hides only removed lines of a changed file.
   */
  lineRange: SnippetLineRange | undefined;
}

/**
 * The boundary folds a snippet has now, as `getSnippetFolds()` returns them.
 * A side with nothing hidden (the range starts at line 1, or the reader
 * opened that fold all the way) has no key.
 *
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export interface SnippetFolds {
  above?: SnippetFold;
  below?: SnippetFold;
}

/**
 * `onSnippetExpand` argument: a reader clicked the fold above or below the
 * snippet's line range. Call `preventDefault()` to keep the fold closed and
 * handle the click yourself (for example, link to the full file).
 *
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export interface SnippetExpandEvent {
  /** The fold the reader clicked. */
  fold: SnippetFold;
  /**
   * Source lines the built-in reveal opens: `expansionLineCount`, or
   * Infinity for "Expand all" and shift-click.
   */
  lineCount: number;
  /** The click that asked for the reveal. */
  event: MouseEvent;
  /** Keeps the fold closed: the built-in reveal does not run. */
  preventDefault(): void;
  /** True once `preventDefault()` was called. */
  readonly defaultPrevented: boolean;
}

/**
 * What a snippet shows for one render: a contiguous run of base rows (the
 * render range, in rows of the current diff style under the current hunk
 * expansion) and the folds above and below it.
 */
export interface SnippetClip {
  renderRange: RenderRange;
  above: SnippetFold | undefined;
  below: SnippetFold | undefined;
  /** First and last range-numbered line inside the clip. */
  shownLines: SnippetLineRange | undefined;
}

/** Attribute that marks the two boundary separators ("above" / "below"). */
export const SNIPPET_BOUNDARY_ATTRIBUTE = 'data-snippet-boundary';
/** Present on a boundary separator whose hidden lines include changes. */
export const SNIPPET_CHANGES_ATTRIBUTE = 'data-snippet-changes';
/** The group holding a boundary separator's "-D" / "+A" change pills. */
export const SNIPPET_CHANGE_COUNTS_ATTRIBUTE = 'data-snippet-change-counts';
/** The "-D" pill: removed lines hidden behind a boundary fold. */
export const SNIPPET_DELETIONS_COUNT_ATTRIBUTE = 'data-snippet-deletions-count';
/** The "+A" pill: added lines hidden behind a boundary fold. */
export const SNIPPET_ADDITIONS_COUNT_ATTRIBUTE = 'data-snippet-additions-count';
/**
 * Set on the server-rendered `<pre>` to the line range it was rendered for, so
 * hydration can tell when the client asks for a different range.
 */
export const SNIPPET_RANGE_ATTRIBUTE = 'data-snippet-range';

// The gap seed that opens a whole gap (the base expansion region shape).
const OPEN_GAP: HunkExpansionRegion = { fromStart: Infinity, fromEnd: 0 };

// The smallest piece the clip can hide or reveal: one row, or a whole
// modification (a change block with removed and added lines), because
// unified and split order a modification's lines differently and cutting
// one would leave the two styles out of step.
interface ClipUnit {
  lines: number;
  // Added and removed lines among `lines` (both 0 for an unchanged row).
  additions: number;
  deletions: number;
  unifiedRows: number;
  splitRows: number;
  firstLine: number | undefined;
  lastLine: number | undefined;
  inRange: boolean;
}

interface Gap {
  index: number;
  firstLine: number;
  lastLine: number;
}

/**
 * What a component gives the controller so the shared behaviors (click
 * dispatch, expandSnippet, revealLine) can run without knowing whether they
 * serve a diff or a file.
 */
export interface SnippetHost {
  /** The clip for the content the component shows now, if any. */
  getSnippetClip(): SnippetClip | undefined;
  rerender(): void;
  onSnippetExpand?(event: SnippetExpandEvent): unknown;
}

/**
 * The shared snippet state for SnippetFileDiff and SnippetFile: the line
 * range, how far a reader opened each boundary fold (in source lines), the
 * math from those to a base render range, and the boundary-click routing.
 * The row walk behind a clip is cached per content target, range and hunk
 * expansion, so a render with nothing changed does no O(lines) work.
 */
export class SnippetController {
  public expansionLineCount: number = DEFAULT_EXPANSION_LINE_COUNT;
  private lastClampWarning = '';
  public collapsedContextThreshold: number =
    DEFAULT_COLLAPSED_CONTEXT_THRESHOLD;
  private range: SnippetLineRange;
  // Source lines opened beyond each range edge. Only ever grows until the
  // range or content changes.
  private opened = { above: 0, below: 0 };
  // Set when the range or contents changed: the next diff layout drops
  // every hunk expansion, seeded or made by a reader.
  private freshLayout = true;
  private layoutDiff: FileDiffMetadata | undefined;
  // The file the reveals belong to, and a token that changes with it (an
  // equal file passed as a new object keeps the token).
  private layoutFile: FileContents | undefined;
  private layoutFileToken: object = {};
  private unitCache: { key: string; target: unknown; units: ClipUnit[] } = {
    key: '',
    target: undefined,
    units: [],
  };
  private clipCache: { key: string; units: ClipUnit[]; clip: SnippetClip } = {
    key: '',
    units: [],
    clip: emptyClip(),
  };
  private host: SnippetHost | undefined;
  private boundPre: HTMLElement | undefined;

  /** `owner` names the component in developer warnings. */
  constructor(private readonly owner: string) {
    this.range = { start: 1, end: 1 };
  }

  public getRange(): SnippetLineRange {
    return this.range;
  }

  /**
   * Returns true when the range changed. A new range is a fresh layout: the
   * reader's boundary reveals and every hunk expansion are dropped.
   */
  public setRange(range: SnippetLineRange): boolean {
    if (range.start === this.range.start && range.end === this.range.end) {
      return false;
    }
    this.range = { ...range };
    this.resetReveals();
    this.freshLayout = true;
    return true;
  }

  private resetReveals(): void {
    this.opened = { above: 0, below: 0 };
  }

  /**
   * Forgets the layout (reveals, cached rows, content) on a full component
   * teardown so the instance holds no row data after cleanUp.
   */
  public reset(): void {
    this.resetReveals();
    this.freshLayout = true;
    this.layoutDiff = undefined;
    this.layoutFile = undefined;
    this.layoutFileToken = {};
    this.unitCache = { key: '', target: undefined, units: [] };
    this.clipCache = { key: '', units: [], clip: emptyClip() };
  }

  /** Grows a boundary fold by `lineCount` source lines (Infinity: all). */
  public open(boundary: 'above' | 'below', lineCount: number): void {
    this.opened[boundary] += lineCount;
  }

  // -- Diffs ---------------------------------------------------------------

  /**
   * The base expansion map a diff render needs, or undefined when `current`
   * already is it. New contents (not an equal diff re-parsed into a new
   * object) or a new range start a fresh layout, which drops every
   * expansion. Then every gap between hunks that is not strictly inside the
   * range is opened whole, so the rows outside the range are one contiguous
   * run of source lines that widening the clip can reveal. Gaps strictly
   * inside the range keep the base behavior (parser context,
   * collapsedContextThreshold, expandHunk). Never mutates `current`; the
   * renderer installs the result. O(hunks).
   */
  public getDiffExpansion(
    diff: FileDiffMetadata,
    current: ReadonlyMap<number, HunkExpansionRegion>
  ): Map<number, HunkExpansionRegion> | undefined {
    if (this.layoutDiff !== diff) {
      if (
        this.layoutDiff != null &&
        !isSameDiffContent(this.layoutDiff, diff)
      ) {
        this.resetReveals();
        this.freshLayout = true;
      }
      this.layoutDiff = diff;
    }
    const next = new Map(this.freshLayout ? [] : current);
    this.freshLayout = false;
    // Gap index i is the gap before hunk i, and hunks.length is the trailing
    // gap: the base convention (pinned by expandedHunkIndex.test.ts).
    const range = this.clampRange(this.range, getMaxLine(diff));
    for (const gap of getDiffGaps(diff)) {
      if (gap.firstLine > range.start && gap.lastLine < range.end) continue;
      next.set(gap.index, OPEN_GAP);
    }
    return areExpansionMapsEqual(next, current) ? undefined : next;
  }

  /** The clip for a prepared diff under the given expansion. */
  public getDiffClip(
    diff: FileDiffMetadata,
    diffStyle: 'unified' | 'split',
    expandedHunks: Map<number, HunkExpansionRegion> | true
  ): SnippetClip {
    const range = this.clampRange(this.range, getMaxLine(diff));
    const unitKey = [
      range.start,
      range.end,
      this.collapsedContextThreshold,
      getExpansionKey(expandedHunks),
    ].join('|');
    if (this.unitCache.target !== diff || this.unitCache.key !== unitKey) {
      this.unitCache = {
        key: unitKey,
        target: diff,
        units: getDiffClipUnits(
          diff,
          range,
          expandedHunks,
          this.collapsedContextThreshold
        ),
      };
    }
    return this.clipUnits(this.unitCache.units, diffStyle);
  }

  // -- Files ---------------------------------------------------------------

  /**
   * The clip for a plain file of `lineCount` lines (one unit per line). New
   * contents forget the reader's reveals; an equal file passed as a new
   * object (same cacheKey, or same name, contents and lang, as File
   * compares them) keeps them.
   */
  public getFileClip(file: FileContents, lineCount: number): SnippetClip {
    if (this.layoutFile !== file) {
      if (
        this.layoutFile != null &&
        !areFileTargetsEqual(this.layoutFile, file)
      ) {
        this.resetReveals();
        this.layoutFileToken = {};
      }
      this.layoutFile = file;
    }
    const key = this.layoutFileToken;
    const range = this.clampRange(this.range, lineCount);
    const unitKey = `${range.start}|${range.end}|${lineCount}`;
    if (this.unitCache.target !== key || this.unitCache.key !== unitKey) {
      const units: ClipUnit[] = [];
      for (let line = 1; line <= lineCount; line++) {
        units.push({
          lines: 1,
          additions: 0,
          deletions: 0,
          unifiedRows: 1,
          splitRows: 1,
          firstLine: line,
          lastLine: line,
          inRange: line >= range.start && line <= range.end,
        });
      }
      this.unitCache = { key: unitKey, target: key, units };
    }
    return this.clipUnits(this.unitCache.units, 'unified');
  }

  // -- Shared --------------------------------------------------------------

  // Keeps the units in range plus what the reader opened and converts that
  // to a render range. Cached on the unit list, reveals and style.
  private clipUnits(
    units: ClipUnit[],
    diffStyle: 'unified' | 'split'
  ): SnippetClip {
    const key = `${this.opened.above}|${this.opened.below}|${diffStyle}|${this.collapsedContextThreshold}`;
    if (this.clipCache.units === units && this.clipCache.key === key) {
      return this.clipCache.clip;
    }
    const clip = computeClip(
      units,
      diffStyle,
      this.opened,
      this.collapsedContextThreshold
    );
    this.clipCache = { key, units, clip };
    return clip;
  }

  // A range past the end of the content addresses its last line, with one
  // console.warn per range and content length (the CodeView.scrollTo style
  // for an input that cannot be honored as given).
  private clampRange(
    range: SnippetLineRange,
    maxLine: number
  ): SnippetLineRange {
    const clamped = clampRange(range, maxLine);
    if (clamped.start !== range.start || clamped.end !== range.end) {
      const key = `${range.start}-${range.end}/${maxLine}`;
      if (key !== this.lastClampWarning) {
        this.lastClampWarning = key;
        console.warn(
          `${this.owner}: lineRange ${range.start}-${range.end} is past the last line (${maxLine}); showing ${clamped.start}-${clamped.end}`
        );
      }
    }
    return clamped;
  }

  /**
   * Source lines the given boundary must have opened so that `line` is
   * shown, or undefined when the line is not in the content. Callers check
   * the clip's shown lines first. Reads the units the clip was just built
   * from (getSnippetClip refreshes them).
   */
  private getRevealAmount(
    line: number
  ): { boundary: 'above' | 'below'; lineCount: number } | undefined {
    const units = this.clipCache.units;
    const first = units.findIndex((unit) => unit.inRange);
    const last = units.findLastIndex((unit) => unit.inRange);
    if (first < 0) return undefined;
    const target = units.findIndex(
      (unit) =>
        unit.firstLine != null &&
        unit.lastLine != null &&
        line >= unit.firstLine &&
        line <= unit.lastLine
    );
    if (target < 0 || (target >= first && target <= last)) return undefined;
    let lineCount = 0;
    if (target < first) {
      for (let i = target; i < first; i++) lineCount += units[i].lines;
      return lineCount > this.opened.above
        ? { boundary: 'above', lineCount }
        : undefined;
    }
    for (let i = last + 1; i <= target; i++) lineCount += units[i].lines;
    return lineCount > this.opened.below
      ? { boundary: 'below', lineCount }
      : undefined;
  }

  /** One boundary separator; same markup as a base hunk separator. */
  public createBoundarySeparator(
    fold: SnippetFold,
    hunkSeparators: HunkSeparators | ((...args: never[]) => unknown)
  ): HASTElement {
    const element = createSeparator({
      type:
        hunkSeparators === 'line-info-basic' ? 'line-info-basic' : 'line-info',
      content: getModifiedLinesString(fold.hiddenLines, fold.containsChanges),
      // Any index makes createSeparator draw the expand buttons; the
      // attribute is removed below so nothing reads it as a hunk index.
      expandIndex: 0,
      chunked: fold.hiddenLines > this.expansionLineCount,
      isFirstHunk: fold.boundary === 'above',
      isLastHunk: fold.boundary === 'below',
    });
    delete element.properties['data-expand-index'];
    element.properties[SNIPPET_BOUNDARY_ATTRIBUTE] = fold.boundary;
    if (fold.containsChanges) {
      element.properties[SNIPPET_CHANGES_ATTRIBUTE] = '';
      findSeparatorContent(element)?.children.push(createChangeCounts(fold));
    }
    return element;
  }

  // -- Component behaviors -------------------------------------------------

  /** Connects the component this controller serves. */
  public connect(host: SnippetHost): void {
    this.host = host;
  }

  /**
   * Routes reader clicks on the boundary separators of `pre`. Boundary
   * separators carry no `data-expand-index`, so InteractionManager never
   * sees them as hunk separators; this listener is their only route.
   * Re-binding to the same element is a no-op.
   */
  public bindClicks(pre: HTMLElement | undefined): void {
    if (pre === this.boundPre) return;
    this.boundPre?.removeEventListener('click', this.handleClick);
    this.boundPre = pre;
    pre?.addEventListener('click', this.handleClick);
  }

  private handleClick = (event: Event): void => {
    const target = event.target as Element | null;
    const button = target?.closest?.(
      `[data-expand-button], [data-unmodified-lines], [${SNIPPET_CHANGE_COUNTS_ATTRIBUTE}]`
    );
    const separator = button?.closest(`[${SNIPPET_BOUNDARY_ATTRIBUTE}]`);
    const boundary = separator?.getAttribute(SNIPPET_BOUNDARY_ATTRIBUTE);
    if (boundary !== 'above' && boundary !== 'below') return;
    // The same rule as InteractionManager: "Expand all" or a shift-click
    // opens everything, otherwise one step.
    const all =
      button!.hasAttribute('data-expand-all-button') ||
      (event as MouseEvent).shiftKey;
    this.dispatchClick(
      boundary,
      all ? Number.POSITIVE_INFINITY : this.expansionLineCount,
      event as MouseEvent
    );
  };

  // A reader click: tell the host first; preventDefault keeps it closed.
  private dispatchClick(
    boundary: 'above' | 'below',
    lineCount: number,
    event: MouseEvent
  ): void {
    const host = this.host;
    const fold = host?.getSnippetClip()?.[boundary];
    if (host == null || fold == null) return;
    if (host.onSnippetExpand != null) {
      let defaultPrevented = false;
      host.onSnippetExpand({
        fold: toPublicFold(fold),
        lineCount,
        event,
        preventDefault: () => {
          defaultPrevented = true;
        },
        get defaultPrevented() {
          return defaultPrevented;
        },
      });
      if (defaultPrevented) return;
    }
    this.open(boundary, lineCount);
    host.rerender();
  }

  /**
   * Copies of the boundary folds the next render draws, from the same clip
   * the render and `onSnippetExpand` use. Empty with no content.
   */
  public getFolds(): SnippetFolds {
    const clip = this.host?.getSnippetClip();
    const folds: SnippetFolds = {};
    if (clip?.above != null) folds.above = toPublicFold(clip.above);
    if (clip?.below != null) folds.below = toPublicFold(clip.below);
    return folds;
  }

  /**
   * Widens the clip on one side; does not call `onSnippetExpand`. Returns
   * false when there is no fold on that side.
   */
  public expandSnippet(
    owner: string,
    boundary: 'above' | 'below',
    lineCount: number | undefined
  ): boolean {
    assertLineCount(owner, 'lineCount', lineCount, 1);
    if (this.host?.getSnippetClip()?.[boundary] == null) return false;
    this.open(boundary, lineCount ?? this.expansionLineCount);
    this.host.rerender();
    return true;
  }

  /**
   * Opens a boundary fold far enough to show `line` plus one
   * `expansionLineCount` step beyond it, as FileDiff.revealLine opens a hunk
   * gap. Returns 'opened', 'outside' when the line is not hidden by a
   * boundary fold (it is inside the clip, or not in the content), or 'none'
   * with no content.
   */
  public revealLine(line: number): 'opened' | 'outside' | 'none' {
    const clip = this.host?.getSnippetClip();
    if (clip == null) return 'none';
    // Shown already: inside the range, opened, or shown by the threshold or
    // a whole modification.
    const shown = clip.shownLines;
    if (shown != null && line >= shown.start && line <= shown.end) {
      return 'outside';
    }
    const reveal = this.getRevealAmount(line);
    if (reveal == null) return 'outside';
    this.opened[reveal.boundary] = reveal.lineCount + this.expansionLineCount;
    this.host!.rerender();
    return 'opened';
  }
}

function emptyClip(): SnippetClip {
  return {
    renderRange: {
      startingLine: 0,
      totalLines: 0,
      bufferBefore: 0,
      bufferAfter: 0,
    },
    above: undefined,
    below: undefined,
    shownLines: undefined,
  };
}

// Opens whole units until the requested source lines are shown (a
// modification the step lands inside is shown whole). A fold whose full
// size is within the base collapsedContextThreshold is never drawn: its
// lines are shown, as the base does for a gap that small.
function computeClip(
  units: ClipUnit[],
  diffStyle: 'unified' | 'split',
  opened: { above: number; below: number },
  threshold: number
): SnippetClip {
  let first = units.findIndex((unit) => unit.inRange);
  let last = units.findLastIndex((unit) => unit.inRange);
  if (first < 0) return emptyClip();
  if (sumLines(units, 0, first) <= threshold) first = 0;
  if (sumLines(units, last + 1, units.length) <= threshold) {
    last = units.length - 1;
  }
  let need = opened.above;
  while (need > 0 && first > 0) {
    first--;
    need -= units[first].lines;
  }
  need = opened.below;
  while (need > 0 && last < units.length - 1) {
    last++;
    need -= units[last].lines;
  }
  const rows = (unit: ClipUnit) =>
    diffStyle === 'unified' ? unit.unifiedRows : unit.splitRows;
  let startingLine = 0;
  for (let i = 0; i < first; i++) startingLine += rows(units[i]);
  let totalLines = 0;
  for (let i = first; i <= last; i++) totalLines += rows(units[i]);
  return {
    renderRange: { startingLine, totalLines, bufferBefore: 0, bufferAfter: 0 },
    above: toFold('above', units.slice(0, first)),
    below: toFold('below', units.slice(last + 1)),
    shownLines: getLineSpan(units.slice(first, last + 1)),
  };
}

function sumLines(units: ClipUnit[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to; i++) total += units[i].lines;
  return total;
}

function toFold(
  boundary: 'above' | 'below',
  hidden: ClipUnit[]
): SnippetFold | undefined {
  if (hidden.length === 0) return undefined;
  let hiddenLines = 0;
  let hiddenAdditions = 0;
  let hiddenDeletions = 0;
  for (const unit of hidden) {
    hiddenLines += unit.lines;
    hiddenAdditions += unit.additions;
    hiddenDeletions += unit.deletions;
  }
  return {
    boundary,
    hiddenLines,
    hiddenAdditions,
    hiddenDeletions,
    containsChanges: hiddenAdditions + hiddenDeletions > 0,
    lineRange: getLineSpan(hidden),
  };
}

/**
 * A fold as hosts receive it (`onSnippetExpand`, `getSnippetFolds`): a copy
 * the host may keep or mutate.
 */
export function toPublicFold(fold: SnippetFold): SnippetFold {
  return {
    ...fold,
    lineRange: fold.lineRange != null ? { ...fold.lineRange } : undefined,
  };
}

// The `[data-separator-content]` box createSeparator puts the label in.
function findSeparatorContent(element: HASTElement): HASTElement | undefined {
  for (const child of element.children) {
    if (child.type !== 'element') continue;
    if (child.properties['data-separator-content'] != null) return child;
    const found = findSeparatorContent(child);
    if (found != null) return found;
  }
  return undefined;
}

/**
 * The "-D" / "+A" pills of a boundary fold that hides changes, removed
 * first like the file header's stats; a pill whose count is 0 is left out.
 * The signs carry the meaning without color, and the group's accessible name
 * spells it out ("1 removed, 1 added").
 */
function createChangeCounts(fold: SnippetFold): HASTElement {
  const pills: HASTElement[] = [];
  const names: string[] = [];
  if (fold.hiddenDeletions > 0) {
    pills.push(
      createHastElement({
        tagName: 'span',
        children: [createTextNodeElement(`-${fold.hiddenDeletions}`)],
        properties: { [SNIPPET_DELETIONS_COUNT_ATTRIBUTE]: '' },
      })
    );
    names.push(`${fold.hiddenDeletions} removed`);
  }
  if (fold.hiddenAdditions > 0) {
    pills.push(
      createHastElement({
        tagName: 'span',
        children: [createTextNodeElement(`+${fold.hiddenAdditions}`)],
        properties: { [SNIPPET_ADDITIONS_COUNT_ATTRIBUTE]: '' },
      })
    );
    names.push(`${fold.hiddenAdditions} added`);
  }
  return createHastElement({
    tagName: 'span',
    children: pills,
    properties: {
      [SNIPPET_CHANGE_COUNTS_ATTRIBUTE]: '',
      role: 'img',
      'aria-label': names.join(', '),
    },
  });
}

function getLineSpan(units: ClipUnit[]): SnippetLineRange | undefined {
  const start = units.find((unit) => unit.firstLine != null)?.firstLine;
  const end = units.findLast((unit) => unit.lastLine != null)?.lastLine;
  return start != null && end != null ? { start, end } : undefined;
}

function getMaxLine(diff: FileDiffMetadata): number {
  return diff.type === 'deleted'
    ? diff.deletionLines.length
    : diff.additionLines.length;
}

// A range past the end of the content addresses its last line.
function clampRange(
  range: SnippetLineRange,
  maxLine: number
): SnippetLineRange {
  const start = Math.min(range.start, Math.max(maxLine, 1));
  return { start, end: Math.max(Math.min(range.end, maxLine), start) };
}

function areExpansionMapsEqual(
  a: ReadonlyMap<number, HunkExpansionRegion>,
  b: ReadonlyMap<number, HunkExpansionRegion>
): boolean {
  if (a.size !== b.size) return false;
  for (const [index, region] of a) {
    const other = b.get(index);
    if (
      other == null ||
      other.fromStart !== region.fromStart ||
      other.fromEnd !== region.fromEnd
    ) {
      return false;
    }
  }
  return true;
}

/** The value of SNIPPET_RANGE_ATTRIBUTE for a range. */
export function formatSnippetRange(range: SnippetLineRange): string {
  return `${range.start}-${range.end}`;
}

/**
 * Whether hydrated markup was server-rendered for a different line range
 * than the client asks for (markup without the attribute is not judged).
 */
export function isStaleServerRange(
  pre: HTMLElement | undefined,
  range: SnippetLineRange
): boolean {
  const rendered = pre?.getAttribute(SNIPPET_RANGE_ATTRIBUTE);
  return rendered != null && rendered !== formatSnippetRange(range);
}

/**
 * The diff a snippet renders. A diff with no hunks (identical files, or a
 * pure rename) renders no rows in the base, so it is given one hunk of
 * context lines covering the file: the snippet then shows its range as
 * plain lines with folds above and below. Memoized per input object so the
 * component's equality checks see one stable diff.
 */
export function toSnippetDiff(diff: FileDiffMetadata): FileDiffMetadata {
  const lines = diff.additionLines.length;
  if (
    diff.hunks.length > 0 ||
    lines === 0 ||
    diff.deletionLines.length !== lines
  ) {
    return diff;
  }
  let snippetDiff = CONTEXT_DIFFS.get(diff);
  if (snippetDiff == null) {
    const hunk: Hunk = {
      collapsedBefore: 0,
      additionStart: 1,
      additionCount: lines,
      additionLines: 0,
      additionLineIndex: 0,
      deletionStart: 1,
      deletionCount: lines,
      deletionLines: 0,
      deletionLineIndex: 0,
      hunkContent: [
        { type: 'context', lines, additionLineIndex: 0, deletionLineIndex: 0 },
      ],
      splitLineStart: 0,
      splitLineCount: lines,
      unifiedLineStart: 0,
      unifiedLineCount: lines,
      // Identical sides end the same way; a last line without a newline
      // marks the missing end-of-file newline as the parser does.
      noEOFCRDeletions: diff.deletionLines.at(-1)?.endsWith('\n') !== true,
      noEOFCRAdditions: diff.additionLines.at(-1)?.endsWith('\n') !== true,
    };
    snippetDiff = {
      ...diff,
      // A derived key: the worker pool caches highlights by cacheKey, and a
      // result cached for the hunkless original has no rows for this hunk.
      cacheKey:
        diff.cacheKey != null ? `${diff.cacheKey}:snippet-context` : undefined,
      hunks: [hunk],
      splitLineCount: lines,
      unifiedLineCount: lines,
    };
    CONTEXT_DIFFS.set(diff, snippetDiff);
  }
  return snippetDiff;
}

const CONTEXT_DIFFS = new WeakMap<FileDiffMetadata, FileDiffMetadata>();

// A string that changes whenever the expansion map's contents do. O(hunks).
function getExpansionKey(
  expandedHunks: Map<number, HunkExpansionRegion> | true
): string {
  if (expandedHunks === true) return 'all';
  let key = '';
  for (const [index, region] of expandedHunks) {
    key += `${index}:${region.fromStart}:${region.fromEnd};`;
  }
  return key;
}

// The unchanged gaps between the parser's hunks, by base expansion index
// (gap i sits before hunk i; the trailing gap is hunks.length), numbered on
// the side the range addresses.
function getDiffGaps(diff: FileDiffMetadata): Gap[] {
  const useOld = diff.type === 'deleted';
  const gaps: Gap[] = [];
  diff.hunks.forEach((hunk, index) => {
    const size = Math.max(hunk.collapsedBefore, 0);
    if (size === 0) return;
    const boundary = useOld
      ? getHunkSideStartBoundary(hunk.deletionStart, hunk.deletionCount)
      : getHunkSideStartBoundary(hunk.additionStart, hunk.additionCount);
    gaps.push({ index, firstLine: boundary + 1 - size, lastLine: boundary });
  });
  const trailing = getTrailingContextRangeSize({
    fileDiff: diff,
    errorPrefix: 'SnippetController',
  });
  if (trailing > 0) {
    const max = getMaxLine(diff);
    gaps.push({
      index: diff.hunks.length,
      firstLine: max - trailing + 1,
      lastLine: max,
    });
  }
  return gaps;
}

// Groups the rows the base would render (under the given expansion) into
// clip units, in one unified row walk; each unit records its row count in
// both styles. Pure deletions in a changed file belong to the range when
// they sit inside it or touch one of its edges.
function getDiffClipUnits(
  diff: FileDiffMetadata,
  range: SnippetLineRange,
  expandedHunks: Map<number, HunkExpansionRegion> | true,
  collapsedContextThreshold: number
): ClipUnit[] {
  const useOld = diff.type === 'deleted';
  const units: ClipUnit[] = [];
  const inRange = (first: number, last: number) =>
    last >= range.start && first <= range.end;
  let lastNewLine = 0;
  // The change block being collected: rows of one hunk content block.
  let block:
    | { hunk: number; dels: number[]; adds: number[]; afterLine: number }
    | undefined;
  const flush = () => {
    if (block == null) return;
    const { dels, adds, afterLine } = block;
    block = undefined;
    if (dels.length > 0 && adds.length > 0 && !useOld) {
      units.push({
        lines: dels.length + adds.length,
        additions: adds.length,
        deletions: dels.length,
        unifiedRows: dels.length + adds.length,
        splitRows: Math.max(dels.length, adds.length),
        firstLine: adds[0],
        lastLine: adds.at(-1),
        inRange: inRange(adds[0], adds.at(-1)!),
      });
      return;
    }
    for (const line of useOld ? dels : adds) {
      units.push({
        lines: 1,
        additions: useOld ? 0 : 1,
        deletions: useOld ? 1 : 0,
        unifiedRows: 1,
        splitRows: 1,
        firstLine: line,
        lastLine: line,
        inRange: inRange(line, line),
      });
    }
    if (!useOld) {
      // Pure deletions sit between new lines afterLine and afterLine + 1.
      for (let i = 0; i < dels.length; i++) {
        units.push({
          lines: 1,
          additions: 0,
          deletions: 1,
          unifiedRows: 1,
          splitRows: 1,
          firstLine: undefined,
          lastLine: undefined,
          inRange: afterLine >= range.start - 1 && afterLine <= range.end,
        });
      }
    }
  };
  iterateOverDiff({
    diff,
    diffStyle: 'unified',
    expandedHunks,
    collapsedContextThreshold,
    callback: (row) => {
      if (row.type !== 'change') {
        flush();
        const line = useOld
          ? row.deletionLine.lineNumber
          : row.additionLine.lineNumber;
        lastNewLine = row.additionLine.lineNumber;
        units.push({
          lines: 1,
          additions: 0,
          deletions: 0,
          unifiedRows: 1,
          splitRows: 1,
          firstLine: line,
          lastLine: line,
          inRange: inRange(line, line),
        });
        return;
      }
      if (block != null && block.hunk !== row.hunkIndex) flush();
      block ??= {
        hunk: row.hunkIndex,
        dels: [],
        adds: [],
        afterLine: lastNewLine,
      };
      if (row.deletionLine != null) {
        block.dels.push(row.deletionLine.lineNumber);
      }
      if (row.additionLine != null) {
        block.adds.push(row.additionLine.lineNumber);
        lastNewLine = row.additionLine.lineNumber;
      }
    },
  });
  flush();
  return units;
}

// Whether a layout carries over to `next`: the same target (identity or
// cacheKey), or equal lines and hunks passed as a new object (a host
// re-parsing on every render). Only called when the object changed.
function isSameDiffContent(
  previous: FileDiffMetadata,
  next: FileDiffMetadata
): boolean {
  if (areDiffTargetsEqual(previous, next)) return true;
  return (
    previous.type === next.type &&
    previous.name === next.name &&
    previous.hunks.length === next.hunks.length &&
    previous.hunks.every((hunk, i) => {
      const other = next.hunks[i];
      return (
        hunk.additionStart === other.additionStart &&
        hunk.additionCount === other.additionCount &&
        hunk.deletionStart === other.deletionStart &&
        hunk.deletionCount === other.deletionCount
      );
    }) &&
    areLinesEqual(previous.additionLines, next.additionLines) &&
    areLinesEqual(previous.deletionLines, next.deletionLines)
  );
}

function areLinesEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

/**
 * Checks a host-supplied range synchronously so a bad value fails where it is
 * passed, not later inside a render.
 */
export function assertLineRange(
  owner: string,
  range: unknown
): SnippetLineRange {
  const value = range as Partial<SnippetLineRange> | undefined;
  if (
    value == null ||
    !Number.isInteger(value.start) ||
    !Number.isInteger(value.end) ||
    value.start! < 1 ||
    value.end! < value.start!
  ) {
    throw new RangeError(
      `${owner}: lineRange must be { start, end } with whole numbers and 1 <= start <= end`
    );
  }
  return { start: value.start!, end: value.end! };
}

/** Checks an optional whole-number option or argument. */
export function assertLineCount(
  owner: string,
  name: string,
  value: number | undefined,
  min: number
): void {
  if (
    value != null &&
    (Number.isNaN(value) ||
      value < min ||
      (Number.isFinite(value) && !Number.isInteger(value)))
  ) {
    throw new RangeError(
      `${owner}: ${name} must be a whole number of at least ${min}, or Infinity`
    );
  }
}

/** Rejects a partial (patch-only) diff before any render work starts. */
export function assertCompleteDiff(
  owner: string,
  fileDiff: FileDiffMetadata | undefined
): void {
  if (fileDiff?.isPartial === true) {
    throw new Error(
      `${owner}: a partial diff (parsed from a patch) cannot be shown as a snippet; pass a diff of both full files, e.g. parseDiffFromFile(oldFile, newFile)`
    );
  }
}

/** Checks snippet options synchronously (construction, setOptions, SSR). */
export function assertSnippetOptions(
  owner: string,
  options: { lineRange?: unknown; expansionLineCount?: number } | undefined
): void {
  assertLineRange(owner, options?.lineRange);
  assertLineCount(owner, 'expansionLineCount', options?.expansionLineCount, 1);
}
