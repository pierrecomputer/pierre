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
  preload?: {
    dangerouslySetInnerHTML: {
      __html: string;
    };
  };
}

export function FileDiff<LAnnotation = undefined>(
  props: FileDiffProps<LAnnotation>
) {
  const { oldFile, newFile, options, annotations, className, style, preload } =
    props;
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
    if (firstRender && preload != null) {
      if (annotations != null) {
        instanceRef.current.setLineAnnotations(annotations);
      }
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
  return (
    // @ts-expect-error lol
    <file-diff ref={ref} className={className} style={style}>
      {templateRender(props)}
      {/* @ts-expect-error lol */}
    </file-diff>
  );
}

function templateRender<LAnnotation>({
  oldFile,
  newFile,
  annotations,
  renderAnnotation,
  renderHeaderMetadata,
  preload,
}: FileDiffProps<LAnnotation>) {
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
  if (typeof window === 'undefined' && preload != null) {
    return (
      <>
        <template
          // @ts-expect-error lol
          shadowrootmode="open"
          {...preload}
        />
        {children}
      </>
    );
  }
  return <>{children}</>;
}
