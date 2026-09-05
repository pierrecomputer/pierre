import {
  getLineAnnotationSource,
  type LineAnnotationPosition,
} from './lineAnnotationIdentity';

/**
 * Annotation state for an active edit session. Like the private
 * `editSessionFile`/`editSessionDiff` render models, we avoid mutating the
 * original annotations and instead create a duplicate set that we mutate as
 * needed while the user is editing the file or diff.  When editing is
 * finished, we can either revert back to the old state, or inherit the new
 * mutated annotations.
 *
 * `current` holds the annotations actually rendered; the editor replaces
 * them as edits move annotations between lines. `provided` is the last
 * annotations array the component rendered with. When a render is called with
 * annotations, we check whether it's a new array or the existing annotations
 * we've previously rendered. If new, we fully replace whatever the edit
 * session derived since there's no way to really reasonably rectify existing
 * state. If it's the same as `provided` or `current`, we continue assuming
 * `current` is the latest source of truth.
 *
 * `slotNames` map is a hack to keep annotation content attached while lines
 * move around. Normally slotNames are derived from the target line number (and
 * possibly side of the diff). Doing this while editing would force every
 * annotation that gets moved to remount which is not ideal. So by keeping a
 * reference map of annotation to slot name, we can keep invalid slot names
 * until editing is completed, and then either revert back to our original
 * annotations or update them with their new slot names (which will currently
 * trigger a remount). In a future update we'll add a better ID system for
 * annotations so we don't need to depend on this flawed keying architecture.
 */

export interface EditSessionAnnotations<TAnnotation> {
  provided: TAnnotation[];
  current: TAnnotation[];
  slotNames: Map<object, string>;
}

/**
 * Creates session state when an editor attaches. The array is kept as-is for
 * both `provided` and `current`, and we record each annotation's slot name
 * before any edits can move it.
 *
 * `previousSession` covers a whole new file or diff arriving mid-edit. The
 * annotations that come with it describe the new document, so we rebuild the
 * session around them — but any annotation the outgoing session already
 * named keeps that name, since the caller's content is already rendered into
 * a slot with it. Names for annotations that didn't survive the swap are
 * simply dropped.
 */
export function adoptEditSessionAnnotations<
  TAnnotation extends LineAnnotationPosition,
>(
  annotations: TAnnotation[],
  getName: (annotation: TAnnotation) => string,
  previousSession?: EditSessionAnnotations<TAnnotation>
): EditSessionAnnotations<TAnnotation> {
  const slotNames = new Map<object, string>();
  for (const annotation of annotations) {
    const source = getLineAnnotationSource(annotation);
    slotNames.set(
      source,
      previousSession?.slotNames.get(source) ?? getName(annotation)
    );
  }
  return { provided: annotations, current: annotations, slotNames };
}

/**
 * Handles the caller passing a brand new annotations array while editing is
 * active. We take it exactly as given — line numbers are read against the
 * document as currently edited, and there's no merging with what the session
 * had — so it replaces both `provided` and `current`. Annotations we've seen
 * before keep their recorded slot names; new ones record a name for wherever
 * they landed.
 */
export function writeEditSessionAnnotations<
  TAnnotation extends LineAnnotationPosition,
>(
  session: EditSessionAnnotations<TAnnotation>,
  annotations: TAnnotation[],
  getName: (annotation: TAnnotation) => string
): void {
  for (const annotation of annotations) {
    const source = getLineAnnotationSource(annotation);
    if (!session.slotNames.has(source)) {
      session.slotNames.set(source, getName(annotation));
    }
  }
  session.provided = annotations;
  session.current = annotations;
}

/**
 * Every slot name an editable component renders resolves through here. With
 * no active session this is just the normal position-derived name. During a
 * session we return the recorded name instead, and an annotation we've never
 * seen records its name the first time anyone asks. That way everything that
 * writes slot names — the renderers, the editor, the light-DOM wrappers —
 * lands on the same name for the same annotation.
 */
export function resolveEditSessionSlotName<
  TAnnotation extends LineAnnotationPosition,
>(
  session: EditSessionAnnotations<TAnnotation> | undefined,
  annotation: TAnnotation,
  getName: (annotation: TAnnotation) => string
): string {
  if (session == null) {
    return getName(annotation);
  }
  const source = getLineAnnotationSource(annotation);
  let name = session.slotNames.get(source);
  if (name == null) {
    name = getName(annotation);
    session.slotNames.set(source, name);
  }
  return name;
}
