import { DIFFS_TAG_NAME } from '../constants';
import { Editor, type EditorOptions } from '../editor';
import type { FileContents, LineAnnotation } from '../types';
import type { WorkerPoolManager } from '../worker';
import type { FileOptions } from './File';
import { VirtualizedFile } from './VirtualizedFile';
import { Virtualizer } from './Virtualizer';

export interface CodeEditorOptions<LAnnotation, ElementType = HTMLElement>
  extends
    EditorOptions<LAnnotation>,
    Pick<
      FileOptions<LAnnotation>,
      | 'theme'
      | 'overflow'
      | 'themeType'
      | 'preferredHighlighter'
      | 'tokenizeMaxLineLength'
      | 'tokenizeMaxLength'
      | 'disableLineNumbers'
      | 'disableErrorHandling'
    > {
  overscrollSize?: number;
  workerPoolManager?: WorkerPoolManager;
  renderAnnotation?: (annotation: LineAnnotation<LAnnotation>) => ElementType;
  renderPlaceholder?: () => ElementType;
}

export class CodeEditor<LAnnotation> extends Editor<LAnnotation> {
  private file?: FileContents;
  private scrollContainer: HTMLElement;
  private fileContainer: HTMLElement;
  private virtualizer: Virtualizer;
  private fileInstance: VirtualizedFile<LAnnotation>;
  private renderPlaceholder?: () => HTMLElement;

  constructor(options: CodeEditorOptions<LAnnotation, HTMLElement> = {}) {
    const {
      fileOptions,
      editorOptions,
      overscrollSize,
      workerPoolManager,
      renderAnnotation,
      renderPlaceholder,
    } = splitCodeEditorOptions(options);
    fileOptions.renderAnnotation = renderAnnotation;

    super(editorOptions);

    this.virtualizer = new Virtualizer(
      overscrollSize == null
        ? undefined
        : {
            overscrollSize,
            intersectionObserverMargin: overscrollSize * 4,
          }
    );

    this.scrollContainer = document.createElement('div');
    this.fileContainer = document.createElement(DIFFS_TAG_NAME);
    this.fileInstance = new VirtualizedFile<LAnnotation>(
      fileOptions,
      this.virtualizer,
      undefined,
      workerPoolManager
    );

    this.virtualizer.setup(this.scrollContainer);
    this.scrollContainer.style.cssText =
      'width:100%;height:100%;overflow:auto;';
    this.edit(this.fileInstance);
    this.renderPlaceholder = renderPlaceholder;
  }

  /**
   * Render the editor into `root`.
   */
  render(
    root: HTMLElement,
    file?: FileContents,
    lineAnnotations?: LineAnnotation<LAnnotation>[]
  ): void {
    root.appendChild(this.scrollContainer);

    if (file == null) {
      this.file = undefined;
      if (this.renderPlaceholder != null) {
        const placeholder = this.renderPlaceholder();
        this.scrollContainer.replaceChildren(placeholder);
      } else {
        this.scrollContainer.replaceChildren();
      }
      return;
    }

    if (this.scrollContainer.firstChild !== this.fileContainer) {
      this.scrollContainer.replaceChildren(this.fileContainer);
    }

    this.file = file;
    this.fileInstance.render({
      fileContainer: this.fileContainer,
      file,
      lineAnnotations,
    });
  }

  setFile(
    file: FileContents,
    lineAnnotations?: LineAnnotation<LAnnotation>[]
  ): void {
    if (this.scrollContainer.firstChild !== this.fileContainer) {
      this.scrollContainer.replaceChildren(this.fileContainer);
    }

    this.file = file;
    this.fileInstance.render({
      fileContainer: this.fileContainer,
      file,
      lineAnnotations,
    });
  }

  setLineAnnotations(lineAnnotations: LineAnnotation<LAnnotation>[]): void {
    if (this.file != null) {
      this.fileInstance.render({
        fileContainer: this.fileContainer,
        file: this.file,
        lineAnnotations,
      });
    }
  }

  override cleanUp(recycle = false): void {
    super.cleanUp(recycle);
    this.fileInstance.cleanUp(recycle);
    this.virtualizer.cleanUp();
    this.scrollContainer.remove();
    if (!recycle) {
      this.file = undefined;
    }
  }
}

export function splitCodeEditorOptions<LAnnotation, ElementType = HTMLElement>({
  theme,
  overflow,
  themeType,
  preferredHighlighter,
  tokenizeMaxLineLength,
  tokenizeMaxLength,
  renderAnnotation,
  disableErrorHandling,
  disableLineNumbers,
  overscrollSize,
  workerPoolManager,
  renderPlaceholder,
  ...editorOptions
}: CodeEditorOptions<LAnnotation, ElementType>): {
  fileOptions: FileOptions<LAnnotation>;
  editorOptions: EditorOptions<LAnnotation>;
  overscrollSize?: number;
  workerPoolManager?: WorkerPoolManager;
  renderPlaceholder?: () => ElementType;
  renderAnnotation?: (annotation: LineAnnotation<LAnnotation>) => ElementType;
} {
  return {
    fileOptions: {
      theme,
      overflow,
      themeType,
      preferredHighlighter,
      tokenizeMaxLineLength,
      tokenizeMaxLength,
      disableErrorHandling,
      disableLineNumbers,
      useTokenTransformer: true,
      disableFileHeader: true,
    },
    editorOptions,
    overscrollSize,
    workerPoolManager,
    renderAnnotation,
    renderPlaceholder,
  };
}
