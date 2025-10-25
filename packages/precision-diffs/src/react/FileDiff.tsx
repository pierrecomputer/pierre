'use client';

import deepEqual from 'fast-deep-equal';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';

import {
  type DiffFileRendererOptions,
  FileDiff as FileDiffUI,
} from '../FileDiff';
import { HEADER_METADATA_SLOT_ID } from '../constants';
import {
  type DiffLineAnnotation,
  type FileContents,
  type FileDiffMetadata,
  type RenderHeaderMetadataProps,
} from '../types';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { parsePatchFiles } from '../utils/parsePatchFiles';
import { useStableCallback } from './utils/useStableCallback';

export type { FileContents };

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface FileDiffSharedProps<LAnnotation> {
  options?: DiffFileRendererOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode;
  renderHeaderMetadata?(props: RenderHeaderMetadataProps): ReactNode;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
}

interface FileDiffBeforeAfterProps<LAnnotation>
  extends FileDiffSharedProps<LAnnotation> {
  patch?: undefined;
  oldFile: FileContents;
  newFile: FileContents;
}

interface FileDiffPatchProps<LAnnotation>
  extends FileDiffSharedProps<LAnnotation> {
  patch: string;
  oldFile?: undefined;
  newFile?: undefined;
}

export type FileDiffProps<LAnnotation> =
  | FileDiffBeforeAfterProps<LAnnotation>
  | FileDiffPatchProps<LAnnotation>;

export function FileDiff<LAnnotation = undefined>(
  props: FileDiffProps<LAnnotation>
) {
  const {
    options,
    annotations,
    className,
    style,
    prerenderedHTML,
    renderAnnotation,
    renderHeaderMetadata,
  } = props;

  const patch = 'patch' in props ? props.patch : undefined;
  let oldFile: FileContents | undefined;
  let newFile: FileContents | undefined;

  if (patch == null) {
    ({ oldFile, newFile } = props as FileDiffBeforeAfterProps<LAnnotation>);
    if (oldFile == null || newFile == null) {
      throw new Error(
        'FileDiff: you must provide either a patch or both oldFile and newFile'
      );
    }
  }

  const fileDiffFromPatch = useMemo<FileDiffMetadata | undefined>(() => {
    if (patch == null) {
      return undefined;
    }
    const files = parsePatchFiles(patch)
      .flatMap((parsed) => parsed.files);
    if (files.length === 0) {
      throw new Error(
        'FileDiff: provided patch does not include a file diff'
      );
    }
    if (files.length > 1) {
      throw new Error(
        'FileDiff: provided patch must contain exactly one file diff'
      );
    }
    return files[0];
  }, [patch]);

  const renderProps =
    fileDiffFromPatch != null
      ? { fileDiff: fileDiffFromPatch }
      : { oldFile: oldFile!, newFile: newFile! };

  const instanceRef = useRef<FileDiffUI<LAnnotation> | null>(null);
  const ref = useStableCallback((node: HTMLElement | null) => {
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
        ...renderProps,
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
      ...renderProps,
      lineAnnotations: annotations,
    });
  });
  const metadata = renderHeaderMetadata?.(
    'fileDiff' in renderProps
      ? { fileDiff: renderProps.fileDiff }
      : { oldFile: renderProps.oldFile, newFile: renderProps.newFile }
  );
  const children = (
    <>
      {metadata != null && <div slot={HEADER_METADATA_SLOT_ID}>{metadata}</div>}
      {renderAnnotation != null &&
        annotations?.map((annotation, index) => (
          <div key={index} slot={getLineAnnotationName(annotation)}>
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
