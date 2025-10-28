import type {
  Element,
  ElementContent,
  Properties,
  Root,
  RootContent,
  Text,
} from 'hast';

import { HEADER_METADATA_SLOT_ID } from '../constants';
import type {
  AnnotationSpan,
  BaseDiffProps,
  ChangeTypes,
  FileContents,
  FileDiffMetadata,
  HunkSeparators,
  PJSHighlighter,
  PJSThemeNames,
  SharedRenderState,
  ThemeTypes,
  ThemesType,
} from '../types';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { getIconForType } from './getIconForType';

export function createTextNode(value: string): Text {
  return { type: 'text', value };
}

interface CreateHastElementProps {
  tagName:
    | 'span'
    | 'div'
    | 'code'
    | 'pre'
    | 'slot'
    | 'svg'
    | 'use'
    | 'style'
    | 'template';
  children?: ElementContent[];
  properties?: Properties;
}

export function createHastElement({
  tagName,
  children = [],
  properties = {},
}: CreateHastElementProps): Element {
  return {
    type: 'element',
    tagName,
    properties,
    children,
  };
}

interface CreateSeparatorProps {
  type: HunkSeparators;
  content?: string;
  expandIndex?: number;
  slotName?: string;
}

export function createSeparator({
  type,
  content,
  expandIndex,
  slotName,
}: CreateSeparatorProps): Element {
  const children = [];
  if (type === 'metadata' && content != null) {
    children.push(
      createHastElement({
        tagName: 'div',
        children: [createTextNode(content)],
        properties: { 'data-separator-content': '' },
      })
    );
  }
  if (type === 'line-info' && content != null) {
    const contentChildren: ElementContent[] = [createTextNode(content)];
    if (expandIndex != null) {
      contentChildren.unshift(createIcon({ name: 'pjs-icon-chevrons-narrow' }));
    }
    children.push(
      createHastElement({
        tagName: 'div',
        children: contentChildren,
        properties: { 'data-separator-content': '' },
      })
    );
  }
  if (type === 'custom' && slotName != null) {
    children.push(
      createHastElement({
        tagName: 'slot',
        properties: { name: slotName },
      })
    );
  }
  return createHastElement({
    tagName: 'div',
    children,
    properties: {
      'data-separator': children.length === 0 ? '' : type,
      'data-expand-index': expandIndex,
    },
  });
}

interface CreateIconProps {
  name: string;
  width?: number;
  height?: number;
  properties?: Properties;
}

export function createIcon({
  name,
  width = 16,
  height = 16,
  properties,
}: CreateIconProps): Element {
  return createHastElement({
    tagName: 'svg',
    properties: { width, height, viewBox: '0 0 16 16', ...properties },
    children: [
      createHastElement({
        tagName: 'use',
        properties: { href: `#${name.replace(/^#/, '')}` },
      }),
    ],
  });
}

export function createAnnotationElement(span: AnnotationSpan): Element {
  return createHastElement({
    tagName: 'div',
    children: [
      createHastElement({
        tagName: 'div',
        children: span.annotations?.map((slotId) =>
          createHastElement({ tagName: 'slot', properties: { name: slotId } })
        ),
        properties: { 'data-annotation-content': '' },
      }),
    ],
    properties: {
      'data-line-annotation': `${span.hunkIndex},${span.lineIndex}`,
    },
  });
}

export function createEmptyRowBuffer(size: number): Element {
  return createHastElement({
    tagName: 'div',
    properties: {
      'data-buffer': '',
      style: `grid-row: span ${size};min-height:calc(${size} * 1lh)`,
    },
  });
}

export function findCodeElement(nodes: Root | Element): Element | undefined {
  let firstChild: RootContent | Element | Root | null = nodes.children[0];
  while (firstChild != null) {
    if (firstChild.type === 'element' && firstChild.tagName === 'code') {
      return firstChild;
    }
    if ('children' in firstChild) {
      firstChild = firstChild.children[0];
    } else {
      firstChild = null;
    }
  }
  return undefined;
}

export function convertLine(
  node: Element,
  line: number,
  state: SharedRenderState
): ElementContent {
  const lineInfo = state.lineInfo[line];
  if (lineInfo == null) {
    throw new Error(`convertLine: line ${line}, contains no state.lineInfo`);
  }
  // We need to convert the current line to a div but keep all the decorations
  // that may be applied
  node.tagName = 'span';
  node.properties['data-column-content'] = '';
  if (lineInfo.metadataContent != null) {
    node.children.push(
      createHastElement({
        tagName: 'span',
        children: [createTextNode(lineInfo.metadataContent)],
        properties: { 'data-no-newline': '' },
      })
    );
  }
  // NOTE(amadeus): We need to push newline characters into empty rows or else
  // copy/pasta will have issues
  else if (node.children.length === 0) {
    node.children.push(createTextNode('\n'));
  }
  const children = [node];
  if (!state.disableLineNumbers) {
    children.unshift(
      createHastElement({
        tagName: 'span',
        children:
          lineInfo.metadataContent == null
            ? [{ type: 'text', value: `${lineInfo.lineNumber}` }]
            : [],
        properties: { 'data-column-number': '' },
      })
    );
  }
  return createHastElement({
    tagName: 'div',
    children,
    properties: {
      'data-line':
        lineInfo.metadataContent == null ? `${lineInfo.lineNumber}` : '',
      'data-line-type': lineInfo.type,
    },
  });
}

interface CreatePreWrapperPropertiesProps
  extends Pick<
    BaseDiffProps,
    'overflow' | 'themeType' | 'diffIndicators' | 'disableBackground'
  > {
  theme?: PJSThemeNames;
  themes?: ThemesType;
  split: boolean;
  highlighter: PJSHighlighter;
}

export function createPreWrapperProperties({
  diffIndicators = 'bars',
  disableBackground = false,
  highlighter,
  overflow = 'scroll',
  split,
  theme,
  themeType = 'system',
  themes,
}: CreatePreWrapperPropertiesProps): Properties {
  const properties: Properties = {
    'data-pjs': '',
    'data-type': split ? 'split' : 'file',
    'data-overflow': overflow,
    // NOTE(amadeus): Alex, here we would probably set a class property
    // instead, when that's working and supported
    style: getHighlighterThemeStyles({ theme, themes, highlighter }),
    tabIndex: 0,
  };

  if (theme != null && themeType !== 'system') {
    properties['data-theme-type'] = themeType;
  } else if (theme != null) {
    const themeData = highlighter.getTheme(theme);
    properties['data-theme-type'] = themeData.type;
  }

  switch (diffIndicators) {
    case 'bars':
    case 'classic':
      properties['data-indicators'] = diffIndicators;
      break;
  }

  if (!disableBackground) {
    properties['data-background'] = '';
  }

  return properties;
}

interface CreateFileHeaderProps {
  fileOrDiff: FileDiffMetadata | FileContents;
  theme?: PJSThemeNames;
  themes?: ThemesType;
  highlighter: PJSHighlighter;
  prefix?: string;
  themeType?: ThemeTypes;
}

export function createFileHeaderElement({
  fileOrDiff,
  theme,
  themes,
  highlighter,
  prefix,
  themeType = 'system',
}: CreateFileHeaderProps): Element {
  const fileDiff = 'type' in fileOrDiff ? fileOrDiff : undefined;
  const properties: Properties = {
    'data-pjs-header': '',
    style: getHighlighterThemeStyles({
      theme,
      themes,
      highlighter,
      prefix,
    }),
  };

  if (fileDiff != null) {
    properties['data-change-type'] = fileDiff.type;
  }

  // If a theme is specified, then we should just override the themeType and
  // ignore whatever might be passed in
  if (theme != null) {
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
}: CreateHeaderElementOptions): Element {
  const children: ElementContent[] = [
    createIcon({
      name: getIconForType(iconType),
      properties: { 'data-change-icon': iconType },
    }),
  ];
  if (prevName != null) {
    children.push(
      createHastElement({
        tagName: 'div',
        children: [createTextNode(prevName)],
        properties: {
          'data-prev-name': '',
        },
      })
    );
    children.push(
      createIcon({
        name: 'pjs-icon-arrow',
        properties: {
          'data-rename-icon': '',
        },
      })
    );
  }
  children.push(
    createHastElement({
      tagName: 'div',
      children: [createTextNode(name)],
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
): Element {
  const children: ElementContent[] = [];
  if (fileDiff != null) {
    let additions = 0;
    let deletions = 0;
    for (const hunk of fileDiff.hunks) {
      for (const line of hunk.hunkContent ?? []) {
        if (line.startsWith('+')) {
          additions++;
        } else if (line.startsWith('-')) {
          deletions++;
        }
      }
    }
    if (deletions > 0) {
      children.push(
        createHastElement({
          tagName: 'span',
          children: [createTextNode(`-${deletions}`)],
          properties: { 'data-deletions-count': '' },
        })
      );
    }
    if (additions > 0) {
      children.push(
        createHastElement({
          tagName: 'span',
          children: [createTextNode(`+${additions}`)],
          properties: { 'data-additions-count': '' },
        })
      );
    }
    if (deletions === 0 && additions === 0) {
      children.push(
        createHastElement({
          tagName: 'span',
          children: [createTextNode('No diff')],
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
