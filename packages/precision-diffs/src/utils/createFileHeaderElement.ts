import type { ElementContent, Element as HASTElement, Properties } from 'hast';

import { HEADER_METADATA_SLOT_ID } from '../constants';
import type {
  ChangeTypes,
  FileContents,
  FileDiffMetadata,
  PJSHighlighter,
  PJSThemeNames,
  ThemeTypes,
  ThemesType,
} from '../types';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { getIconForType } from './getIconForType';
import {
  createHastElement,
  createIconElement,
  createTextNodeElement,
} from './hast_utils';

export interface CreateFileHeaderElementProps {
  fileOrDiff: FileDiffMetadata | FileContents;
  theme?: PJSThemeNames | ThemesType;
  highlighter: PJSHighlighter;
  prefix?: string;
  themeType?: ThemeTypes;
}

export function createFileHeaderElement({
  fileOrDiff,
  theme,
  highlighter,
  prefix,
  themeType = 'system',
}: CreateFileHeaderElementProps): HASTElement {
  const fileDiff = 'type' in fileOrDiff ? fileOrDiff : undefined;
  const properties: Properties = {
    'data-pjs-header': '',
    style: getHighlighterThemeStyles({ theme, highlighter, prefix }),
  };

  if (fileDiff != null) {
    properties['data-change-type'] = fileDiff.type;
  }

  // If a theme is specified, then we should just override the themeType and
  // ignore whatever might be passed in
  if (typeof theme === 'string') {
    const themeData = highlighter.getTheme(theme);
    properties['data-theme-type'] = themeData.type;
  } else if (themeType !== 'system') {
    properties['data-theme-type'] = themeType;
  }

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
