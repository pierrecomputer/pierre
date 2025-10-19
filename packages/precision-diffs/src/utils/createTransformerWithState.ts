import type { ElementContent } from 'hast';

import type { SharedRenderState, ShikiTransformer } from '../types';
import {
  convertLine,
  createAnnotationElement,
  createEmptyRowBuffer,
  findCodeElement,
} from './hast_utils';

export function createTransformerWithState(disableLineNumbers: boolean): {
  state: SharedRenderState;
  transformer: ShikiTransformer;
} {
  const state: SharedRenderState = {
    lineInfo: {},
    decorations: [],
    disableLineNumbers,
  };
  return {
    state,
    transformer: {
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
  };
}
