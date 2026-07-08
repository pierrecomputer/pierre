'use client';

import {
  type CSSProperties,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import {
  CodeEditor as CodeEditorClass,
  type CodeEditorOptions,
} from '../components/CodeEditor';
import type { FileContents, LineAnnotation } from '../types';
import { areOptionsEqual } from '../utils/areOptionsEqual';
import { WorkerPoolContext } from './WorkerPoolContext';

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface CodeEditorProps<LAnnotation = undefined> {
  file?: FileContents;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
  options?: Omit<CodeEditorOptions<LAnnotation>, 'workerPoolManager'>;
  className?: string;
  style?: CSSProperties;
  disableWorkerPool?: boolean;
}

export function CodeEditor<LAnnotation = undefined>({
  className,
  disableWorkerPool = false,
  file,
  lineAnnotations,
  options,
  style,
}: CodeEditorProps<LAnnotation>): React.JSX.Element {
  const poolManager = useContext(WorkerPoolContext);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<CodeEditorClass<LAnnotation> | null>(null);
  const optionsRef = useRef<CodeEditorOptions<LAnnotation> | undefined>(
    undefined
  );

  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    if (root == null) {
      return;
    }

    const nextOptions: CodeEditorOptions<LAnnotation> | undefined =
      options == null && (disableWorkerPool || poolManager == null)
        ? undefined
        : {
            ...options,
            workerPoolManager: !disableWorkerPool ? poolManager : undefined,
          };

    if (
      editorRef.current == null ||
      !areOptionsEqual(optionsRef.current, nextOptions)
    ) {
      editorRef.current?.cleanUp();
      root.replaceChildren();
      editorRef.current = new CodeEditorClass<LAnnotation>(nextOptions);
      optionsRef.current = nextOptions;
      editorRef.current.render(root, file, lineAnnotations);
      return;
    }

    if (file == null) {
      editorRef.current.render(root);
    } else {
      editorRef.current.setFile(file, lineAnnotations);
    }
  });

  useEffect(() => {
    const root = rootRef.current;
    return () => {
      editorRef.current?.cleanUp();
      editorRef.current = null;
      optionsRef.current = undefined;
      root?.replaceChildren();
    };
  }, []);

  return <div ref={rootRef} className={className} style={style} />;
}
