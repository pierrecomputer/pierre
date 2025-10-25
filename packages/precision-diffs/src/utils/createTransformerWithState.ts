import {
  type ShikiTransformerStyleToClass,
  transformerStyleToClass,
} from '@shikijs/transformers';
import type { ElementContent } from 'hast';

import type { SharedRenderState, ShikiTransformer } from '../types';
import {
  convertLine,
  createAnnotationElement,
  createEmptyRowBuffer,
  findCodeElement,
} from './hast_utils';

interface CreateTransformerWithStateOptions {
  disableLineNumbers: boolean;
  useCSSClasses: boolean;
}

interface CreateTransformerWithStateReturn {
  state: SharedRenderState;
  transformers: ShikiTransformer[];
  toClass: ShikiTransformerStyleToClass;
}

export function createTransformerWithState({
  disableLineNumbers,
  useCSSClasses,
}: CreateTransformerWithStateOptions): CreateTransformerWithStateReturn {
  const state: SharedRenderState = {
    lineInfo: {},
    decorations: [],
    disableLineNumbers,
  };
  const transformers: ShikiTransformer[] = [
    {
      line(node) {
        // Remove the default class
        delete node.properties.class;
        return node;
      },
      pre(pre) {
        // NOTE(amadeus): This kinda sucks -- basically we can't apply our
        // line node changes until AFTER decorations have been applied
        const code = findCodeElement(pre);
        const children: ElementContent[] = [];
        if (code != null) {
          let index = 1;
          for (const node of code.children) {
            if (node.type !== 'element') {
              continue;
            }
            // Do we need to inject an empty span above the first line line?
            if (index === 1 && state.lineInfo[0]?.spans != null) {
              for (const span of state.lineInfo[0]?.spans ?? []) {
                if (span.type === 'gap') {
                  children.push(createEmptyRowBuffer(span.rows));
                } else {
                  children.push(createAnnotationElement(span));
                }
              }
            }
            children.push(convertLine(node, index, state));
            const lineInfo = state.lineInfo[index];
            if (lineInfo?.spans != null) {
              for (const span of lineInfo.spans) {
                if (span.type === 'gap') {
                  children.push(createEmptyRowBuffer(span.rows));
                } else {
                  children.push(createAnnotationElement(span));
                }
              }
            }
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
