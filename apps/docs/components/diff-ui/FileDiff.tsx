import { useEffectEvent } from '@/lib/useEffectEvent';
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
  const ref = useEffectEvent((node: HTMLElement | null) => {
    if (node != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'FileDiff: An instance should not already exist when a node is created'
        );
      }
      // FIXME: Ideally we don't use FileDiffUI here, and instead amalgamate
      // the renderers manually
      instanceRef.current = new FileDiffUI(options, true);
      instanceRef.current.hydrate({
        oldFile,
        newFile,
        fileContainer: node,
        lineAnnotations: annotations,
      });
    } else {
      if (instanceRef.current == null) {
        throw new Error(
          'FileDiff: A FileDiff instance should exist when unmounting'
        );
      }
      instanceRef.current.cleanUp();
      instanceRef.current = null;
    }
  });
  useIsometricEffect(() => {
    if (instanceRef.current == null) return;
    const forceRender = !deepEqual(instanceRef.current.options, options);
    instanceRef.current.setOptions(options);
    void instanceRef.current.render({
      forceRender,
      oldFile,
      newFile,
      lineAnnotations: annotations,
    });
  });
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
