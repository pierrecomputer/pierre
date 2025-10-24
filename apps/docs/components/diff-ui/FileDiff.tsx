import {
  type DiffFileRendererOptions,
  type DiffLineAnnotation,
  type FileContents,
  FileDiff as FileDiffUI,
  HEADER_METADATA_SLOT_ID,
  type RenderHeaderMetadataProps,
  getLineAnnotationId,
} from '@pierre/precision-diffs';
import deepEqual from 'fast-deep-equal';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

export type { FileContents };

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface FileDiffProps<LAnnotation> {
  oldFile: FileContents;
  newFile: FileContents;
  options?: DiffFileRendererOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode;
  renderHeaderMetadata?(props: RenderHeaderMetadataProps): ReactNode;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
}

export function FileDiff<LAnnotation = undefined>({
  oldFile,
  newFile,
  options,
  annotations,
  className,
  style,
  prerenderedHTML,
  renderAnnotation,
  renderHeaderMetadata,
}: FileDiffProps<LAnnotation>) {
  const instanceRef = useRef<FileDiffUI<LAnnotation> | null>(null);
  const ref = useRef<HTMLElement>(null);
  // NOTE(amadeus): This is all a temporary hack until we can figure out proper
  // innerHTML shadow dom stuff
  useIsometricEffect(() => {
    if (ref.current == null) return;
    const firstRender = instanceRef.current == null;
    instanceRef.current ??= new FileDiffUI<LAnnotation>(options, true);
    const forceRender = !deepEqual(instanceRef.current.options, options);
    instanceRef.current.setOptions(options);
    if (firstRender && prerenderedHTML != null) {
      instanceRef.current.hydrate({
        oldFile,
        newFile,
        fileContainer: ref.current,
        lineAnnotations: annotations,
      });
    } else {
      void instanceRef.current.render({
        forceRender,
        oldFile,
        newFile,
        fileContainer: ref.current,
        lineAnnotations: annotations,
      });
    }
  });
  useIsometricEffect(
    () => () => {
      instanceRef.current?.cleanUp();
      instanceRef.current = null;
    },
    []
  );
  const metadata = renderHeaderMetadata?.({ oldFile, newFile });
  const children = (
    <>
      {metadata != null && <div slot={HEADER_METADATA_SLOT_ID}>{metadata}</div>}
      {renderAnnotation != null &&
        annotations?.map((annotation, index) => (
          <div key={index} slot={getLineAnnotationId(annotation)}>
            {renderAnnotation(annotation)}
          </div>
        ))}
    </>
  );
  return (
    <file-diff ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </file-diff>
  );
}

function templateRender(children: ReactNode, __html?: string) {
  if (typeof window === 'undefined' && __html != null) {
    return (
      <>
        <template
          // @ts-expect-error unclear how to fix this
          shadowrootmode="open"
          dangerouslySetInnerHTML={{ __html }}
        />
        {children}
      </>
    );
  }
  return <>{children}</>;
}
