import { AttachedThemes, ResolvedThemes } from './constants';

export function cleanUpResolvedThemes(): void {
  ResolvedThemes.clear();
  AttachedThemes.clear();
}
