import {
  type BundledLanguage,
  type DiffsThemeNames,
  isHighlighterNull,
  preloadHighlighter,
} from '@pierre/diffs';
import * as React from 'react';
import { useCallback, useState } from 'react';

import { CodeConfigs } from '../mocks/';
import '../style.css';
import { createFakeContentStream } from '../utils/createFakeContentStream';
import { FileStream, type FileStreamProps } from './FileStream';

export function App() {
  const [codez, setCodez] = useState<FileStreamProps[]>([]);

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
      const themes: DiffsThemeNames[] = [];
      for (const item of CodeConfigs) {
        if ('lang' in item.options) {
          langs.push(item.options.lang);
        }
        if ('themes' in item.options) {
          themes.push(item.options.theme.dark);
          themes.push(item.options.theme.light);
        }
        // else if ('theme' in item.options) {
        //   themes.push(item.options.theme);
        // }
      }
      void preloadHighlighter({ langs, themes });
    }
  }, []);

  return (
    <>
      <div className="tools">
        <button onClick={handleStartStreaming} onPointerEnter={handlePreload}>
          Stream Code
        </button>
        <div>
          [<a href="/">RAW</a> / <strong>REACT</strong>]
        </div>
      </div>
      <div id="content" className="content">
        {codez.map((props, index) => (
          <FileStream {...props} key={index} />
        ))}
      </div>
    </>
  );
}
