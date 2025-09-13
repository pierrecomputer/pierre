import { useCallback, useState } from 'react';
import '../style.css';
import { CodeConfigs } from '../test_files/';
import { CodeRenderer, type CodeRendererProps } from './CodeRenderer';
import { createFakeContentStream } from '../utils/createFakeContentStream';
import type { BundledLanguage, BundledTheme } from 'shiki';
import { isHighlighterNull, preloadHighlighter } from 'pierrejs';

export function App() {
  const [codez, setCodez] = useState<CodeRendererProps[]>([]);

  const toggleTheme = useCallback(() => {
    for (const code of document.querySelectorAll('[data-theme]')) {
      if (!(code instanceof HTMLElement)) return;
      if (code.dataset.theme === 'dark') {
        code.dataset.theme = 'light';
      } else {
        code.dataset.theme = 'dark';
      }
    }
  }, []);

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
      const themes: BundledTheme[] = [];
      for (const item of CodeConfigs) {
        langs.push(item.options.lang);
        themes.push(item.options.themes.dark);
        themes.push(item.options.themes.light);
      }
      preloadHighlighter({ langs, themes });
    }
  }, []);

  return (
    <>
      <div className="tools">
        <button onClick={toggleTheme}>Toggle Theme</button>
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
