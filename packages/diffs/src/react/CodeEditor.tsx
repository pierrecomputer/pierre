'use client';

import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  type ReactNode,
  useImperativeHandle,
  useMemo,
} from 'react';

import {
  type CodeEditorOptions,
  splitCodeEditorOptions,
} from '../components/CodeEditor';
import type { Editor } from '../editor';
import type { FileContents, LineAnnotation } from '../types';
import { EditorProvider } from './EditorContext';
import { File } from './File';
import { useStableEditor } from './utils/useStableEditor';
import { Virtualizer } from './Virtualizer';

export interface CodeEditorProps<
  LAnnotation = undefined,
> extends CodeEditorOptions<LAnnotation, ReactNode> {
  file?: FileContents;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
  prerenderedHTML?: string;
  className?: string;
  style?: CSSProperties;
  disableWorkerPool?: boolean;
}

function CodeEditorImpl<LAnnotation = undefined>(
  {
    className,
    disableWorkerPool = false,
    file,
    lineAnnotations,
    prerenderedHTML,
    style,
    ...options
  }: CodeEditorProps<LAnnotation>,
  ref: ForwardedRef<Editor<LAnnotation>>
): React.JSX.Element {
  const {
    fileOptions,
    editorOptions,
    overscrollSize,
    renderPlaceholder,
    renderAnnotation,
  } = splitCodeEditorOptions(options);

  const editor = useStableEditor(editorOptions);
  const virtualizerConfig = useMemo(
    () =>
      overscrollSize == null
        ? undefined
        : {
            overscrollSize,
            intersectionObserverMargin: overscrollSize * 4,
          },
    [overscrollSize]
  );

  useImperativeHandle(ref, () => editor, [editor]);

  return (
    <EditorProvider editor={editor}>
      <Virtualizer
        key={overscrollSize ?? 'default'}
        config={virtualizerConfig}
        className={className}
        style={style}
        contentStyle={{
          display: 'flex',
          minHeight: '100%',
          width: '100%',
        }}
      >
        {file == null ? (
          renderPlaceholder?.()
        ) : (
          <File
            style={{
              flex: '1 1 auto',
              minWidth: '100%',
            }}
            file={file}
            lineAnnotations={lineAnnotations}
            options={fileOptions}
            renderAnnotation={renderAnnotation}
            disableWorkerPool={disableWorkerPool}
            prerenderedHTML={prerenderedHTML}
            contentEditable
          />
        )}
      </Virtualizer>
    </EditorProvider>
  );
}

export const CodeEditor = forwardRef(CodeEditorImpl) as <
  LAnnotation = undefined,
>(
  props: CodeEditorProps<LAnnotation> & {
    ref?: ForwardedRef<Editor<LAnnotation>>;
  }
) => React.JSX.Element;
