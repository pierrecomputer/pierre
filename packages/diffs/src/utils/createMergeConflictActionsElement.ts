import type { Element as HASTElement } from 'hast';

import type { MergeConflictResolution } from '../types';
import { createHastElement, createTextNodeElement } from './hast_utils';

interface CreateMergeConflictActionsElementProps {
  conflictIndex: number;
  lineIndex: number;
  type: 'default' | 'custom';
  slotName?: string;
}

interface CreateMergeConflictActionButtonProps {
  conflictIndex: number;
  resolution: MergeConflictResolution;
  label: string;
}

function createActionButton({
  conflictIndex,
  resolution,
  label,
}: CreateMergeConflictActionButtonProps): HASTElement {
  return createHastElement({
    tagName: 'button',
    children: [createTextNodeElement(label)],
    properties: {
      type: 'button',
      'data-merge-conflict-action': resolution,
      'data-merge-conflict-index': `${conflictIndex}`,
    },
  });
}

export function createMergeConflictActionsElement({
  conflictIndex,
  lineIndex,
  type,
  slotName,
}: CreateMergeConflictActionsElementProps): HASTElement {
  const actionContentChildren =
    type === 'custom' && slotName != null
      ? [createHastElement({ tagName: 'slot', properties: { name: slotName } })]
      : [
          createActionButton({
            conflictIndex,
            resolution: 'current',
            label: 'Accept current change',
          }),
          createHastElement({
            tagName: 'span',
            properties: { 'data-merge-conflict-action-separator': '' },
            children: [createTextNodeElement(' | ')],
          }),
          createActionButton({
            conflictIndex,
            resolution: 'incoming',
            label: 'Accept incoming change',
          }),
          createHastElement({
            tagName: 'span',
            properties: { 'data-merge-conflict-action-separator': '' },
            children: [createTextNodeElement(' | ')],
          }),
          createActionButton({
            conflictIndex,
            resolution: 'both',
            label: 'Accept both',
          }),
        ];

  return createHastElement({
    tagName: 'div',
    children: [
      createHastElement({
        tagName: 'div',
        children: actionContentChildren,
        properties: { 'data-merge-conflict-actions-content': '' },
      }),
    ],
    properties: {
      'data-merge-conflict-actions': '',
      'data-merge-conflict-index': `${conflictIndex}`,
      'data-line-type': 'context',
      'data-line-index': `${lineIndex}`,
    },
  });
}
