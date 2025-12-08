import { AttachedLanguages, ResolvedLanguages } from './constants';

export function cleanUpResolvedLanguages(): void {
  ResolvedLanguages.clear();
  AttachedLanguages.clear();
}
