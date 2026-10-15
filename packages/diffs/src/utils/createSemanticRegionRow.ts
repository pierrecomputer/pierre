import type { Element as HASTElement, Properties } from 'hast';

import type { SVGSpriteNames } from '../sprite';
import type {
  LineTypes,
  SemanticDiffCollapsibleRegion,
  SemanticDiffCollapsibleRegionCounts,
} from '../types';
import {
  createHastElement,
  createIconElement,
  createTextNodeElement,
} from './hast_utils';

// TODO: Figure out how to internationalize this...
function formatLineCount(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'}`;
}

// The summary a collapsed region of moved code shows in place of its lines,
// such as "Moved 3 lines, edited 1 line". Every old line in the region counts once, so the
// moved total covers the whole region; edits and removals inside it follow
// when there are any.
export function formatCollapsedMoveSummary({
  moved,
  edited,
  removed,
}: SemanticDiffCollapsibleRegionCounts): string {
  const parts = [`Moved ${formatLineCount(moved + edited + removed)}`];
  if (edited > 0) parts.push(`edited ${formatLineCount(edited)}`);
  if (removed > 0) parts.push(`removed ${formatLineCount(removed)}`);
  return parts.join(', ');
}

// The gutter cell of a collapsed region's row: the icon its first line shows
// when expanded, the summary, and the expand button. The label overflows into
// the content column. Pressing anywhere on the row expands the region; once
// expanded, its lines render as usual and the icon on its first line collapses
// it again.
export function createSemanticRegionGutter(
  region: SemanticDiffCollapsibleRegion,
  lineType: LineTypes,
  icon: SVGSpriteNames
): HASTElement {
  return createHastElement({
    tagName: 'div',
    properties: {
      'data-gutter-buffer': 'semantic-region',
      'data-semantic-region-toggle': region.old.start,
      'data-line-type': lineType,
    },
    children: [
      createHastElement({
        tagName: 'div',
        properties: { 'data-semantic-region-label': '' },
        children: [
          createIconElement({
            name: icon,
            properties: {
              'data-semantic-region-icon': '',
              'aria-hidden': 'true',
            },
          }),
          createHastElement({
            tagName: 'span',
            properties: { 'data-semantic-region-summary': '' },
            children: [
              createTextNodeElement(formatCollapsedMoveSummary(region.counts)),
            ],
          }),
          createHastElement({
            tagName: 'button',
            properties: {
              type: 'button',
              'data-semantic-region-button': '',
              'data-semantic-region-toggle': region.old.start,
              'aria-expanded': 'false',
              'aria-label': 'Expand moved lines',
            },
            children: [
              createIconElement({
                name: 'diffs-icon-expand-all',
                properties: {
                  'data-semantic-region-icon': '',
                  'aria-hidden': 'true',
                },
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// The content cell of a collapsed region's row. It stands in for the region's
// old lines, so connector measurement can end their bands on it.
export function createSemanticRegionContent(
  region: SemanticDiffCollapsibleRegion,
  lineType: LineTypes
): HASTElement {
  return createHastElement({
    tagName: 'div',
    properties: {
      'data-semantic-region': '',
      'data-semantic-region-start': region.old.start,
      'data-semantic-region-end': region.old.end,
      'data-semantic-region-toggle': region.old.start,
      'data-line-type': lineType,
    },
  });
}

// Properties that make an expanded region's first-line icon collapse it again.
export function getSemanticRegionIconToggleProperties(
  region: SemanticDiffCollapsibleRegion
): Properties {
  return {
    'data-semantic-region-toggle': region.old.start,
    role: 'button',
    'aria-hidden': undefined,
    'aria-expanded': 'true',
    'aria-label': 'Collapse moved lines',
  };
}
