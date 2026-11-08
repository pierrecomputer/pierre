import type { Element as HASTElement } from 'hast';

import { i18n } from '../i18n/I18n';
import type { LineTypes } from '../types';
import { createHastElement, createTextNodeElement } from './hast_utils';

export function createNoNewlineElement(type: LineTypes): HASTElement {
  return createHastElement({
    tagName: 'div',
    children: [
      createHastElement({
        tagName: 'span',
        children: [createTextNodeElement(i18n.t('noNewlineAtEndOfFile'))],
      }),
    ],
    properties: {
      'data-no-newline': '',
      'data-line-type': type,
      'data-column-content': '',
    },
  });
}
