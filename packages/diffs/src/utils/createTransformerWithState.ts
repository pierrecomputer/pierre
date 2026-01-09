import {
  type ShikiTransformerStyleToClass,
  transformerStyleToClass,
} from '@shikijs/transformers';
import type { ElementContent } from 'hast';

import type { SharedRenderState, ShikiTransformer } from '../types';
import { findCodeElement } from './hast_utils';
import { processLine } from './processLine';

interface CreateTransformerWithStateReturn {
  state: SharedRenderState;
  transformers: ShikiTransformer[];
  toClass: ShikiTransformerStyleToClass;
}

export function createTransformerWithState(
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
            children.push(processLine(node, index, state));
            index++;
          }
          code.children = children;
        }
        return pre;
      },
    },
  ];
  if (useCSSClasses) {
    transformers.push(tokenStyleNormalizer, toClass);
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
