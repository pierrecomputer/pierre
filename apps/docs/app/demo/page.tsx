'use client';

import {
  type BundledLanguage,
  File,
  FileDiff,
  FileStream,
  type PJSThemeNames,
  type ParsedPatch,
  type SupportedLanguages,
  getFiletypeFromFileName,
  isHighlighterNull,
  parseDiffFromFile,
  parsePatchFiles,
  preloadHighlighter,
} from '@pierre/precision-diffs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createFakeContentStream } from './createFakeContentStream';
import {
  CODE_STREAM_CONFIGS,
  DEFAULT_FILES,
  DEMO_ASSET_PATHS,
  FAKE_DIFF_LINE_ANNOTATIONS,
  FAKE_LINE_ANNOTATIONS,
  type LineCommentMetadata,
} from './data';
import './demo.css';
import { ensureFileDiffElement } from './ensureFileDiffElement';
import { renderAnnotation, renderDiffAnnotation } from './renderAnnotation';

const assetCache = new Map<string, Promise<string>>();

function isBundledLanguage(
  lang: SupportedLanguages | undefined
): lang is BundledLanguage {
  return lang != null && lang !== 'text';
}

function loadAsset(path: string) {
  let promise = assetCache.get(path);
  if (promise == null) {
    promise = fetch(path).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load asset at ${path}`);
      }
      return response.text();
    });
    assetCache.set(path, promise);
  }
  return promise;
}

function createCommitMetadataElement(patchMetadata: string) {
  const metadata = document.createElement('div');
  metadata.className = 'demo-commit-metadata';
  metadata.textContent = patchMetadata.replace(/\n+$/, '');
  return metadata;
}

export default function DemoPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const diffInstancesRef = useRef<FileDiff<LineCommentMetadata>[]>([]);
  const streamingInstancesRef = useRef<FileStream[]>([]);
  const fileInstancesRef = useRef<File<LineCommentMetadata>[]>([]);
  const parsedPatchesRef = useRef<ParsedPatch[] | null>(null);

  const [isDiffMode, setIsDiffMode] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [useUnifiedDiff, setUseUnifiedDiff] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [oldFileName, setOldFileName] = useState<string>(
    DEFAULT_FILES.old.name
  );
  const [newFileName, setNewFileName] = useState<string>(
    DEFAULT_FILES.new.name
  );
  const [oldFileContent, setOldFileContent] = useState('');
  const [newFileContent, setNewFileContent] = useState('');

  const cleanupDiffInstances = useCallback(() => {
    for (const instance of diffInstancesRef.current) {
      instance.cleanUp();
    }
    diffInstancesRef.current = [];
  }, []);

  const cleanupStreamingInstances = useCallback(() => {
    for (const instance of streamingInstancesRef.current) {
      instance.cleanUp();
    }
    streamingInstancesRef.current = [];
  }, []);

  const cleanupFileInstances = useCallback(() => {
    for (const instance of fileInstancesRef.current) {
      instance.cleanUp();
    }
    fileInstancesRef.current = [];
  }, []);

  useEffect(() => {
    ensureFileDiffElement();
  }, []);

  useEffect(() => {
    void loadAsset(DEFAULT_FILES.old.assetPath)
      .then((content) => {
        setOldFileContent(content);
      })
      .catch((error) => {
        console.error('Failed to load old file content', error);
      });
    void loadAsset(DEFAULT_FILES.new.assetPath)
      .then((content) => {
        setNewFileContent(content);
      })
      .catch((error) => {
        console.error('Failed to load new file content', error);
      });
  }, []);

  useEffect(() => {
    return () => {
      cleanupDiffInstances();
      cleanupStreamingInstances();
      cleanupFileInstances();
    };
  }, [cleanupDiffInstances, cleanupStreamingInstances, cleanupFileInstances]);

  useEffect(() => {
    if (containerRef.current != null) {
      const docTheme = document.documentElement.dataset.themeType;
      if (docTheme != null) {
        containerRef.current.dataset.themeType = docTheme;
      }
    }
  }, []);

  const loadParsedPatches = useCallback(async () => {
    if (parsedPatchesRef.current != null) {
      return parsedPatchesRef.current;
    }
    const content = await loadAsset(DEMO_ASSET_PATHS.diff);
    const parsed = parsePatchFiles(content);
    parsedPatchesRef.current = parsed;
    return parsed;
  }, []);

  const handlePreloadStreams = useCallback(() => {
    if (!isHighlighterNull()) return;
    const langs: BundledLanguage[] = [];
    const themes: PJSThemeNames[] = [];
    for (const item of CODE_STREAM_CONFIGS) {
      const { lang, themes: optionThemes, theme } = item.options;
      if (isBundledLanguage(lang)) {
        langs.push(lang);
      }
      if (optionThemes != null) {
        themes.push(optionThemes.dark, optionThemes.light);
      } else if (theme != null) {
        themes.push(theme);
      }
    }
    void preloadHighlighter({ langs, themes });
  }, []);

  const handlePreloadDiff = useCallback(async () => {
    if (parsedPatchesRef.current != null || !isHighlighterNull()) {
      return;
    }
    const parsedPatches = await loadParsedPatches();
    const langs = new Set<SupportedLanguages>();
    for (const parsedPatch of parsedPatches) {
      for (const file of parsedPatch.files) {
        const lang = getFiletypeFromFileName(file.name);
        if (lang != null) {
          langs.add(lang);
        }
      }
    }
    void preloadHighlighter({
      langs: Array.from(langs),
      themes: ['tokyo-night', 'solarized-light'],
    });
  }, [loadParsedPatches]);

  const renderDiff = useCallback(
    (parsedPatches: ParsedPatch[]) => {
      const wrapper = wrapperRef.current;
      if (wrapper == null) return;
      cleanupStreamingInstances();
      cleanupFileInstances();
      cleanupDiffInstances();
      wrapper.innerHTML = '';
      setIsDiffMode(true);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0 });
      }

      const containerTheme =
        containerRef.current?.dataset.themeType ??
        document.documentElement.dataset.themeType;
      const prefersDark =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const systemTheme = prefersDark ? 'dark' : 'light';
      const themeType =
        containerTheme === 'dark'
          ? 'dark'
          : containerTheme === 'light'
            ? 'light'
            : systemTheme;

      let patchIndex = 0;
      for (const parsedPatch of parsedPatches) {
        if (parsedPatch.patchMetadata != null) {
          wrapper.appendChild(
            createCommitMetadataElement(parsedPatch.patchMetadata)
          );
        }
        const patchAnnotations = FAKE_DIFF_LINE_ANNOTATIONS[patchIndex] ?? [];
        let hunkIndex = 0;
        for (const fileDiff of parsedPatch.files) {
          const fileAnnotations = patchAnnotations[hunkIndex];
          const instance = new FileDiff<LineCommentMetadata>({
            themes: { dark: 'pierre-dark', light: 'pierre-light' },
            diffStyle: useUnifiedDiff ? 'unified' : 'split',
            overflow: wrapLines ? 'wrap' : 'scroll',
            renderAnnotation: renderDiffAnnotation,
            themeType,
            onLineClick(props) {
              console.log('onLineClick', props);
            },
            onLineNumberClick(props) {
              console.info('onLineNumberClick', props);
            },
          });

          const fileContainer = document.createElement('file-diff');
          wrapper.appendChild(fileContainer);

          void instance.render({
            fileDiff,
            lineAnnotations: fileAnnotations,
            fileContainer,
          });

          diffInstancesRef.current.push(instance);
          hunkIndex++;
        }
        patchIndex++;
      }
    },
    [
      cleanupDiffInstances,
      cleanupFileInstances,
      cleanupStreamingInstances,
      useUnifiedDiff,
      wrapLines,
    ]
  );

  const handleLoadDiff = useCallback(async () => {
    const parsedPatches = await loadParsedPatches();
    renderDiff(parsedPatches);
  }, [loadParsedPatches, renderDiff]);

  const handleStartStreaming = useCallback(async () => {
    const wrapper = wrapperRef.current;
    if (wrapper == null) return;
    cleanupDiffInstances();
    cleanupStreamingInstances();
    cleanupFileInstances();
    wrapper.innerHTML = '';
    setIsDiffMode(false);

    for (const { assetPath, letterByLetter, options } of CODE_STREAM_CONFIGS) {
      const content = await loadAsset(assetPath);
      const instance = new FileStream(options);
      await instance.setup(
        createFakeContentStream(content, letterByLetter),
        wrapper
      );
      streamingInstancesRef.current.push(instance);
    }
  }, [cleanupDiffInstances, cleanupFileInstances, cleanupStreamingInstances]);

  const handleRenderFile = useCallback(async () => {
    const wrapper = wrapperRef.current;
    if (wrapper == null) return;
    setIsDiffMode(false);
    cleanupDiffInstances();
    cleanupStreamingInstances();
    cleanupFileInstances();
    wrapper.innerHTML = '';
    const instance = new File<LineCommentMetadata>({
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
      renderAnnotation,
    });
    const contents = await loadAsset(DEFAULT_FILES.new.assetPath);
    await instance.render({
      file: { name: 'main.tsx', contents },
      containerWrapper: wrapper,
      lineAnnotations: FAKE_LINE_ANNOTATIONS,
    });
    fileInstancesRef.current.push(instance);
  }, [cleanupDiffInstances, cleanupFileInstances, cleanupStreamingInstances]);

  const handleToggleTheme = useCallback(() => {
    const prefersDark =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    const systemTheme = prefersDark ? 'dark' : 'light';
    const currentTheme =
      (document.documentElement.dataset.themeType ??
        containerRef.current?.dataset.themeType ??
        systemTheme) === 'dark'
        ? 'dark'
        : 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.themeType = nextTheme;
    if (containerRef.current != null) {
      containerRef.current.dataset.themeType = nextTheme;
    }

    for (const instance of diffInstancesRef.current) {
      const themeSetting = instance.options.themeType ?? 'system';
      const currentMode =
        themeSetting === 'system' ? currentTheme : themeSetting;
      instance.setThemeType(currentMode === 'light' ? 'dark' : 'light');
    }

    for (const instance of streamingInstancesRef.current) {
      const themeSetting = instance.options.themeType ?? 'system';
      const currentMode =
        themeSetting === 'system' ? currentTheme : themeSetting;
      instance.setThemeType(currentMode === 'light' ? 'dark' : 'light');
    }

    for (const instance of fileInstancesRef.current) {
      const themeSetting = instance.options.themeType ?? 'system';
      const currentMode =
        themeSetting === 'system' ? currentTheme : themeSetting;
      instance.setThemeType(currentMode === 'light' ? 'dark' : 'light');
    }
  }, []);

  useEffect(() => {
    for (const instance of diffInstancesRef.current) {
      instance.setOptions({
        ...instance.options,
        overflow: wrapLines ? 'wrap' : 'scroll',
      });
      void instance.rerender();
    }
  }, [wrapLines]);

  useEffect(() => {
    for (const instance of diffInstancesRef.current) {
      instance.setOptions({
        ...instance.options,
        diffStyle: useUnifiedDiff ? 'unified' : 'split',
      });
      void instance.rerender();
    }
  }, [useUnifiedDiff]);

  const modal = useMemo(() => {
    if (!showDiffModal) return null;
    return (
      <div className="demo-files-input" role="dialog" aria-modal="true">
        <div className="demo-file">
          <input
            type="text"
            value={oldFileName}
            onChange={(event) => setOldFileName(event.target.value)}
            spellCheck={false}
          />
          <textarea
            value={oldFileContent}
            onChange={(event) => setOldFileContent(event.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="demo-file">
          <input
            type="text"
            value={newFileName}
            onChange={(event) => setNewFileName(event.target.value)}
            spellCheck={false}
          />
          <textarea
            value={newFileContent}
            onChange={(event) => setNewFileContent(event.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="demo-buttons">
          <button
            onClick={() => {
              setShowDiffModal(false);
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const oldFile = {
                name: oldFileName,
                contents: oldFileContent,
              };
              const newFile = {
                name: newFileName,
                contents: newFileContent,
              };
              setShowDiffModal(false);
              const parsed = parseDiffFromFile(oldFile, newFile);
              renderDiff([{ files: [parsed] }]);
            }}
          >
            Render Diff
          </button>
        </div>
      </div>
    );
  }, [
    newFileContent,
    newFileName,
    oldFileContent,
    oldFileName,
    renderDiff,
    showDiffModal,
  ]);

  return (
    <div className="demo-page" ref={containerRef}>
      <div className="demo-tools-container">
        <div className="demo-tools">
          <button onClick={handleToggleTheme}>Toggle Theme</button>
          <button onClick={() => void handleRenderFile()}>Render File</button>
          <button
            onMouseEnter={() => void handlePreloadStreams()}
            onClick={() => void handleStartStreaming()}
          >
            Stream Code
          </button>
          <button onClick={() => setShowDiffModal(true)}>Diff Two Files</button>
          <button
            onMouseEnter={() => void handlePreloadDiff()}
            onClick={() => void handleLoadDiff()}
          >
            Load Large-ish Diff
          </button>
          <label>
            <input
              type="checkbox"
              checked={useUnifiedDiff}
              onChange={(event) => setUseUnifiedDiff(event.target.checked)}
            />
            Unified Diffs
          </label>
          <label>
            <input
              type="checkbox"
              checked={wrapLines}
              onChange={(event) => setWrapLines(event.target.checked)}
            />
            Wrap Lines
          </label>
        </div>
      </div>
      <div
        ref={wrapperRef}
        className={`demo-wrapper${isDiffMode ? 'demo-wrapper--diff' : ''}`}
      />
      {modal}
    </div>
  );
}
