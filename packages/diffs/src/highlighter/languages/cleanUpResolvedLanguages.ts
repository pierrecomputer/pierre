import {
  AttachedLanguages,
  ResolvedHighlightsLanguages,
  ResolvedLanguages,
} from './constants';

export function cleanUpResolvedLanguages(): void {
  ResolvedLanguages.clear();
  ResolvedHighlightsLanguages.clear();
  AttachedLanguages.clear();
}
