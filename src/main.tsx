import React from 'react';
import ReactDOM from 'react-dom/client';
import './style.css';
// import testContent from './tests/example.txt?raw';
// import testContent2 from './tests/example2.txt?raw';
// import { createFakeContentStream } from './utils/createFakeContentStream';
// import { CodeRenderer } from './pierre-js/CodeRenderer';
// import { createScrollFixer } from './pierre-js/utils/createScrollFixer';
// import { createHighlighterCleanup } from './pierre-js/utils/createHighlighterCleanup';

// const CODE = [
//   {
//     content: testContent,
//     letterByLetter: false,
//     options: {
//       lang: 'typescript',
//       themes: { dark: 'tokyo-night', light: 'vitesse-light' },
//       defaultColor: false,
//       ...createScrollFixer(),
//       ...createHighlighterCleanup(),
//     } as const,
//   },
//   {
//     content: testContent2,
//     letterByLetter: true,
//     options: {
//       lang: 'markdown',
//       themes: { dark: 'solarized-dark', light: 'solarized-light' },
//       defaultColor: false,
//       ...createScrollFixer(),
//       ...createHighlighterCleanup(),
//     } as const,
//   },
// ] as const;

function App() {
  const [theme, setTheme] = React.useState<'light' | 'dark'>('dark');

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    const codes = document.querySelectorAll('[data-theme]');
    for (const code of codes) {
      if (!(code instanceof HTMLElement)) return;
      code.dataset.theme = newTheme;
    }
  };

  // const startStreaming = async () => {
  //   const wrapper = document.getElementById('content');
  //   if (wrapper == null) return;
  //
  //   // Clear existing content
  //   wrapper.innerHTML = '';
  //
  //   for (const { content, letterByLetter, options } of CODE) {
  //     const instance = new CodeRenderer(
  //       createFakeContentStream(content, letterByLetter),
  //       options
  //     );
  //     instance.setup(wrapper);
  //   }
  // };

  return (
    <>
      <div className="tools">
        <button onClick={toggleTheme}>Toggle Theme</button>
        <button onClick={() => {}}>Stream Code</button>
      </div>
      <div id="content" className="content"></div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);

