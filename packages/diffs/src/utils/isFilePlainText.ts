import type { FileContents } from '../types';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';

export function isFilePlainText(file: FileContents): boolean {
  return (file.lang ?? getFiletypeFromFileName(file.name)) === 'text';
}
