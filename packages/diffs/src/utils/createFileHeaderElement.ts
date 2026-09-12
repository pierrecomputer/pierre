import {
  CUSTOM_HEADER_SLOT_ID,
  HEADER_FILENAME_SUFFIX_SLOT_ID,
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
} from '../constants';
import type {
  ChangeTypes,
  ElementContent,
  FileContents,
  FileDiffMetadata,
  FileHeaderRenderMode,
  HElement as HtmlElement,
  HProperties as Properties,
} from '../types';
import { getIconForType } from './getIconForType';
import { createHtmlElement, createIconElement, createTextNode } from './html';

export interface CreateFileHeaderElementProps {
  fileOrDiff: FileDiffMetadata | FileContents;
  mode: FileHeaderRenderMode;
  stickyHeader: boolean;
}

export function createFileHeaderElement({
  fileOrDiff,
  mode,
  stickyHeader,
}: CreateFileHeaderElementProps): HtmlElement {
  const fileDiff = 'type' in fileOrDiff ? fileOrDiff : undefined;
  const properties: Properties = {
    'data-diffs-header': mode,
    'data-change-type': fileDiff?.type,
    'data-sticky': stickyHeader ? '' : undefined,
  };

  return createHtmlElement({
    tagName: 'div',
    children: [
      mode === 'custom'
        ? createHtmlElement({
            tagName: 'slot',
            properties: { name: CUSTOM_HEADER_SLOT_ID },
          })
        : createHeaderElement({
            name: fileOrDiff.name,
            prevName:
              'prevName' in fileOrDiff ? fileOrDiff.prevName : undefined,
            iconType: fileDiff?.type ?? 'file',
          }),
      ...(mode === 'custom' ? [] : [createMetadataElement(fileDiff)]),
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
}: CreateHeaderElementOptions): HtmlElement {
  const children: ElementContent[] = [
    createHtmlElement({
      tagName: 'slot',
      properties: { name: HEADER_PREFIX_SLOT_ID },
    }),
    createIconElement({
      name: getIconForType(iconType),
      properties: { 'data-change-icon': iconType },
    }),
  ];
  if (prevName != null) {
    children.push(
      createHtmlElement({
        tagName: 'div',
        children: [
          createHtmlElement({
            tagName: 'bdi',
            children: [createTextNode(prevName)],
          }),
        ],
        properties: {
          'data-prev-name': '',
        },
      })
    );
    children.push(
      createIconElement({
        name: 'diffs-icon-arrow-right-short',
        properties: {
          'data-rename-icon': '',
        },
      })
    );
  }
  children.push(
    createHtmlElement({
      tagName: 'div',
      children: [
        createHtmlElement({
          tagName: 'bdi',
          children: [createTextNode(name)],
        }),
      ],
      properties: { 'data-title': '' },
    })
  );
  children.push(
    createHtmlElement({
      tagName: 'slot',
      properties: { name: HEADER_FILENAME_SUFFIX_SLOT_ID },
    })
  );
  return createHtmlElement({
    tagName: 'div',
    children,
    properties: { 'data-header-content': '' },
  });
}

function createMetadataElement(
  fileDiff: FileDiffMetadata | undefined
): HtmlElement {
  const children: ElementContent[] = [];
  if (fileDiff != null) {
    let additions = 0;
    let deletions = 0;
    for (const hunk of fileDiff.hunks) {
      additions += hunk.additionLines;
      deletions += hunk.deletionLines;
    }
    if (deletions > 0 || additions === 0) {
      children.push(
        createHtmlElement({
          tagName: 'span',
          children: [createTextNode(`-${deletions}`)],
          properties: { 'data-deletions-count': '' },
        })
      );
    }
    if (additions > 0 || deletions === 0) {
      children.push(
        createHtmlElement({
          tagName: 'span',
          children: [createTextNode(`+${additions}`)],
          properties: { 'data-additions-count': '' },
        })
      );
    }
  }
  children.push(
    createHtmlElement({
      tagName: 'slot',
      properties: { name: HEADER_METADATA_SLOT_ID },
    })
  );
  return createHtmlElement({
    tagName: 'div',
    children,
    properties: { 'data-metadata': '' },
  });
}
