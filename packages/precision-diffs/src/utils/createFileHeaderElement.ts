import type { ElementContent, Element as HASTElement, Properties } from 'hast';

import { HEADER_METADATA_SLOT_ID } from '../constants';
import type {
  ChangeTypes,
  FileContents,
  FileDiffMetadata,
  ThemeTypes,
} from '../types';
import { getIconForType } from './getIconForType';
import {
  createHastElement,
  createIconElement,
  createTextNodeElement,
} from './hast_utils';

export interface CreateFileHeaderElementProps {
  fileOrDiff: FileDiffMetadata | FileContents;
  themeStyles: string;
  themeType: ThemeTypes;
}

export function createFileHeaderElement({
  fileOrDiff,
  themeStyles,
  themeType,
}: CreateFileHeaderElementProps): HASTElement {
  const fileDiff = 'type' in fileOrDiff ? fileOrDiff : undefined;
  const properties: Properties = {
    'data-pjs-header': '',
    'data-change-type': fileDiff?.type,
    'data-theme-type': themeType !== 'system' ? themeType : undefined,
    style: themeStyles,
  };

  return createHastElement({
    tagName: 'div',
    children: [
      createHeaderElement({
        name: fileOrDiff.name,
        prevName: 'prevName' in fileOrDiff ? fileOrDiff.prevName : undefined,
        iconType: fileDiff?.type ?? 'file',
      }),
      createMetadataElement(fileDiff),
    ],
    properties,
  });
}

interface CreateHeaderElementOptions {
  name: string;
  prevName?: string;
  iconType: ChangeTypes | 'file';
}

function createHeaderElement({
  name,
  prevName,
  iconType,
}: CreateHeaderElementOptions): HASTElement {
  const children: ElementContent[] = [
    createIconElement({
      name: getIconForType(iconType),
      properties: { 'data-change-icon': iconType },
    }),
  ];
  if (prevName != null) {
    children.push(
      createHastElement({
        tagName: 'div',
        children: [createTextNodeElement(prevName)],
        properties: {
          'data-prev-name': '',
        },
      })
    );
    children.push(
      createIconElement({
        name: 'pjs-icon-arrow-right-short',
        properties: {
          'data-rename-icon': '',
        },
      })
    );
  }
  children.push(
    createHastElement({
      tagName: 'div',
      children: [createTextNodeElement(name)],
      properties: { 'data-title': '' },
    })
  );
  return createHastElement({
    tagName: 'div',
    children,
    properties: { 'data-header-content': '' },
  });
}

function createMetadataElement(
  fileDiff: FileDiffMetadata | undefined
): HASTElement {
  const children: ElementContent[] = [];
  if (fileDiff != null) {
    let additions = 0;
    let deletions = 0;
    for (const hunk of fileDiff.hunks) {
      additions += hunk.additionLines;
      deletions += hunk.deletionLines;
    }
    if (deletions > 0) {
      children.push(
        createHastElement({
          tagName: 'span',
          children: [createTextNodeElement(`-${deletions}`)],
          properties: { 'data-deletions-count': '' },
        })
      );
    }
    if (additions > 0) {
      children.push(
        createHastElement({
          tagName: 'span',
          children: [createTextNodeElement(`+${additions}`)],
          properties: { 'data-additions-count': '' },
        })
      );
    }
    if (deletions === 0 && additions === 0) {
      children.push(
        createHastElement({
          tagName: 'span',
          children: [createTextNodeElement('No diff')],
        })
      );
    }
  }
  children.push(
    createHastElement({
      tagName: 'slot',
      properties: { name: HEADER_METADATA_SLOT_ID },
    })
  );
  return createHastElement({
    tagName: 'div',
    children,
    properties: { 'data-metadata': '' },
  });
}
