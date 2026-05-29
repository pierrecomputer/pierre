import {
  type ShikiTransformerStyleToClass,
  transformerStyleToClass,
} from '@shikijs/transformers';
import type { ElementContent } from 'hast';
import type { ThemedToken } from 'shiki';

import type { SharedRenderState, ShikiTransformer } from '../types';
import { findCodeElement } from './hast_utils';
import { processLine } from './processLine';
import { wrapTokenFragments } from './wrapTokenFragments';

interface CreateTransformerWithStateReturn {
  state: SharedRenderState;
  transformers: ShikiTransformer[];
  toClass: ShikiTransformerStyleToClass;
}

type TokenWithLineChar = ThemedToken & {
  __lineChar?: number;
};

export function createTransformerWithState(
  useTokenTransformer = false,
  useCSSClasses = false
): CreateTransformerWithStateReturn {
  const state: SharedRenderState = { lineInfo: [] };
  const transformers: ShikiTransformer[] = [
    {
      line(node) {
        // Remove the default class
        delete node.properties.class;
        return node;
      },
      pre(pre) {
        const code = findCodeElement(pre);
        const children: ElementContent[] = [];
        if (code != null) {
          let index = 1;
          for (const node of code.children) {
            if (node.type !== 'element') continue;
            if (useTokenTransformer) {
              wrapTokenFragments(node);
            }
            children.push(processLine(node, index, state));
            index++;
          }
          code.children = children;
        }
        return pre;
      },
      ...(useTokenTransformer
        ? {
            tokens(lines) {
              for (const line of lines) {
                let col = 0;
                for (const token of line) {
                  const tokenWithOriginalRange = token as TokenWithLineChar;
                  tokenWithOriginalRange.__lineChar ??= col;
                  col += token.content.length;
                }
              }
            },
            preprocess(_code, options) {
              options.mergeWhitespaces = 'never';
            },
            span(hast, _line, _char, _lineElement, token) {
              if (token?.offset != null && token.content != null) {
                const tokenWithOriginalRange = token as TokenWithLineChar;
                const tokenChar = tokenWithOriginalRange.__lineChar;
                if (tokenChar != null) {
                  hast.properties['data-char'] = tokenChar;
                }
                return hast;
              }
              return hast;
            },
          }
        : null),
    },
  ];
  if (useCSSClasses) {
    transformers.push(tokenStyleNormalizer, toClass);
  }
  if (useTokenTransformer) {
    // shiki renders empty lines as " " that breaks the editor selection.
    // We replace them with <br> tags.
    transformers.push({
      line: (node) => {
        if (node.type === 'element' && node.children.length === 0) {
          node.children.push({
            type: 'element',
            tagName: 'br',
            properties: {},
            children: [],
          });
        }
        return node;
      },
    });
  }
  return { state, transformers, toClass };
}

const toClass = transformerStyleToClass({ classPrefix: 'hl-' });

// Create a transformer that converts token color/fontStyle to htmlStyle
// This needs to run BEFORE transformerStyleToClass
const tokenStyleNormalizer: ShikiTransformer = {
  name: 'token-style-normalizer',
  tokens(lines) {
    for (const line of lines) {
      for (const token of line) {
        // Skip if htmlStyle is already set
        if (token.htmlStyle != null) continue;

        const style: Record<string, string> = {};

        if (token.color != null) {
          style.color = token.color;
        }
        if (token.bgColor != null) {
          style['background-color'] = token.bgColor;
        }
        if (token.fontStyle != null && token.fontStyle !== 0) {
          // FontStyle is a bitmask: 1 = italic, 2 = bold, 4 = underline
          if ((token.fontStyle & 1) !== 0) {
            style['font-style'] = 'italic';
          }
          if ((token.fontStyle & 2) !== 0) {
            style['font-weight'] = 'bold';
          }
          if ((token.fontStyle & 4) !== 0) {
            style['text-decoration'] = 'underline';
          }
        }

        // Only set htmlStyle if we have any styles
        if (Object.keys(style).length > 0) {
          token.htmlStyle = style;
        }
      }
    }
  },
};
