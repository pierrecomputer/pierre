import type {
  InteractionManagerMode,
  OnTokenEventProps,
} from '../managers/InteractionManager';

interface ShouldUseTokenTransformerProps<TMode extends InteractionManagerMode> {
  onTokenClick?(props: OnTokenEventProps<TMode>, event: MouseEvent): unknown;
  onTokenEnter?(props: OnTokenEventProps<TMode>, event: PointerEvent): unknown;
  onTokenLeave?(props: OnTokenEventProps<TMode>, event: PointerEvent): unknown;
  useTokenTransformer?: boolean;
}

// Token interaction callbacks require token metadata in the markup to fire at
// all, so attaching any token callback enables the transformer;
export function shouldUseTokenTransformer<
  TMode extends 'file' | 'diff' = 'file',
>(options: ShouldUseTokenTransformerProps<TMode> | undefined): boolean {
  return (
    options?.useTokenTransformer === true ||
    options?.onTokenClick != null ||
    options?.onTokenEnter != null ||
    options?.onTokenLeave != null
  );
}
