import './style.css';

export * from '@pierre/shiki-stream';
export * from './CodeRenderer';
export * from './DiffHeaderRenderer';
export * from './DiffHunksRenderer';
export * from './FileDiff';
export * from './SharedHighlighter';
export * from './UniversalRenderer';
export * from './utils/getFiletypeFromFileName';
export * from './utils/html_render_utils';
export * from './utils/parseDiffFromFile';
export * from './utils/parseLineType';
export * from './utils/parsePatchFiles';

// Export theme files
export { default as pierreDarkTheme } from './themes/pierre-dark.json';
export { default as pierreLightTheme } from './themes/pierre-light.json';

export type * from './types';
