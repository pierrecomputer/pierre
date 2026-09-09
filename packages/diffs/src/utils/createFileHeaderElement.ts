import {
  CUSTOM_HEADER_SLOT_ID,
  HEADER_FILENAME_SUFFIX_SLOT_ID,
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
} from '../constants';
import type {
  ChangeTypes,
  FileContents,
  FileDiffMetadata,
  FileHeaderRenderMode,
} from '../types';
import { getIconForType } from './getIconForType';
import type { HTMLAttributes } from './html';
import { createHTMLElement, createIconElement, escapeHTML } from './html';

export interface CreateFileHeaderElementProps {
  fileOrDiff: FileDiffMetadata | FileContents;
  mode: FileHeaderRenderMode;
  stickyHeader: boolean;
}

export function createFileHeaderElement({
  fileOrDiff,
  mode,
  stickyHeader,
}: CreateFileHeaderElementProps): string {
  const fileDiff = 'type' in fileOrDiff ? fileOrDiff : undefined;
  const properties: HTMLAttributes = {
    'data-diffs-header': mode,
    'data-change-type': fileDiff?.type,
    'data-sticky': stickyHeader ? '' : undefined,
  };

  return createHTMLElement(
    'div',
    properties,
    mode === 'custom'
      ? createHTMLElement('slot', { name: CUSTOM_HEADER_SLOT_ID })
      : createHeaderElement({
          name: fileOrDiff.name,
          prevName: 'prevName' in fileOrDiff ? fileOrDiff.prevName : undefined,
          iconType: fileDiff?.type ?? 'file',
        }),
    ...(mode === 'custom' ? [] : [createMetadataElement(fileDiff)])
  );
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
}: CreateHeaderElementOptions): string {
  const children: string[] = [
    createHTMLElement('slot', { name: HEADER_PREFIX_SLOT_ID }),
    createIconElement({
      name: getIconForType(iconType),
      properties: { 'data-change-icon': iconType },
    }),
  ];
  if (prevName != null) {
    children.push(
      createHTMLElement(
        'div',
        {
          'data-prev-name': '',
        },
        createHTMLElement('bdi', null, escapeHTML(prevName))
      )
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
    createHTMLElement(
      'div',
      { 'data-title': '' },
      createHTMLElement('bdi', null, escapeHTML(name))
    )
  );
  children.push(
    createHTMLElement('slot', { name: HEADER_FILENAME_SUFFIX_SLOT_ID })
  );
  return createHTMLElement('div', { 'data-header-content': '' }, ...children);
}

function createMetadataElement(fileDiff: FileDiffMetadata | undefined): string {
  const children: string[] = [];
  if (fileDiff != null) {
    let additions = 0;
    let deletions = 0;
    for (const hunk of fileDiff.hunks) {
      additions += hunk.additionLines;
      deletions += hunk.deletionLines;
    }
    if (deletions > 0 || additions === 0) {
      children.push(
        createHTMLElement(
          'span',
          { 'data-deletions-count': '' },
          escapeHTML(`-${deletions}`)
        )
      );
    }
    if (additions > 0 || deletions === 0) {
      children.push(
        createHTMLElement(
          'span',
          { 'data-additions-count': '' },
          escapeHTML(`+${additions}`)
        )
      );
    }
  }
  children.push(createHTMLElement('slot', { name: HEADER_METADATA_SLOT_ID }));
  return createHTMLElement('div', { 'data-metadata': '' }, ...children);
}
