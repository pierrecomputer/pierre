import type { ExtensionFormatMap } from '../types';

export const EXTENSION_TO_FILE_FORMAT: ExtensionFormatMap = {
  css: 'css',
  go: 'go',
  html: 'html',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  patch: 'diff',
  ts: 'typescript',
  tsx: 'tsx',
  txt: 'text',
  // TODO: Flesh this out...
};

export function getFiletypeFromFileName(fileName: string) {
  return EXTENSION_TO_FILE_FORMAT[fileName.match(/\.([^.]+)$/)?.[1] || ''];
}

export function extendFileFormatMap(map: ExtensionFormatMap) {
  for (const key in map) {
    EXTENSION_TO_FILE_FORMAT[key] = map[key];
  }
}
