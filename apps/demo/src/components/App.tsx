import {
  type BundledLanguage,
  type PJSThemeNames,
  isHighlighterNull,
  preloadHighlighter,
} from '@pierre/diff-ui';
import * as React from 'react';
import { useCallback, useState } from 'react';

import { CodeConfigs } from '../mocks/';
import '../style.css';
import { createFakeContentStream } from '../utils/createFakeContentStream';
import { CodeRenderer, type CodeRendererProps } from './CodeRenderer';

export function App() {
  const [codez, setCodez] = useState<CodeRendererProps[]>([]);

  const handleStartStreaming = useCallback(() => {
    setCodez(
      CodeConfigs.map(({ content, letterByLetter, options }) => ({
        stream: createFakeContentStream(content, letterByLetter),
        options,
      }))
    );
  }, []);

  const handlePreload = useCallback(() => {
    if (isHighlighterNull()) {
      const langs: BundledLanguage[] = [];
      const themes: PJSThemeNames[] = [];
      for (const item of CodeConfigs) {
        if ('lang' in item.options) {
          langs.push(item.options.lang);
        }
        if ('themes' in item.options) {
          themes.push(item.options.themes.dark);
          themes.push(item.options.themes.light);
        } else if ('theme' in item.options) {
          themes.push(item.options.theme);
        }
      }
      void preloadHighlighter({ langs, themes });
    }
  }, []);

  return (
    <>
      <div className="tools">
        <button onClick={handleStartStreaming} onMouseEnter={handlePreload}>
          Stream Code
        </button>
        <div>
          [<a href="/">RAW</a> / <strong>REACT</strong>]
        </div>
      </div>
      <div id="content" className="content">
        {codez.map((props, index) => (
          <CodeRenderer {...props} key={index} />
        ))}
      </div>
    </>
  );
}
