import { preloadFile } from '@pierre/diffs/ssr';

import { ProseWrapper } from '../ProseWrapper';
import {
  STYLING_CODE_GLOBAL,
  STYLING_CODE_INLINE,
  STYLING_CODE_UNSAFE,
} from './constants';
import Content from './content.mdx';

export async function StylingSection() {
  const [stylingGlobal, stylingInline, stylingUnsafe] = await Promise.all([
    preloadFile(STYLING_CODE_GLOBAL),
    preloadFile(STYLING_CODE_INLINE),
    preloadFile(STYLING_CODE_UNSAFE),
  ]);

  return (
    <ProseWrapper>
      <Content
        stylingGlobal={stylingGlobal}
        stylingInline={stylingInline}
        stylingUnsafe={stylingUnsafe}
      />
    </ProseWrapper>
  );
}
