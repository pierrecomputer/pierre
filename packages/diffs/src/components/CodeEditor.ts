import { DIFFS_TAG_NAME } from '../constants';
import { Editor, type EditorOptions, TextDocument } from '../editor';
import type { EditStack } from '../editor/editStack';
import type { FileContents, LineAnnotation } from '../types';
import type { WorkerPoolManager } from '../worker';
import type { FileOptions } from './File';
import { VirtualizedFile } from './VirtualizedFile';
import { Virtualizer } from './Virtualizer';

export interface CodeEditorOptions<LAnnotation>
  extends
    EditorOptions<LAnnotation>,
    Pick<
      FileOptions<LAnnotation>,
      'theme' | 'overflow' | 'themeType' | 'renderAnnotation'
    > {
  overscrollSize?: number;
  workerPoolManager?: WorkerPoolManager;
  renderPlaceholder?: () => HTMLElement;
}

export class CodeEditor<LAnnotation> extends Editor<LAnnotation> {
  private file?: FileContents;
  private scrollContainer: HTMLElement;
  private fileContainer: HTMLElement;
  private fileInstance: VirtualizedFile<LAnnotation>;
  private renderPlaceholder?: () => HTMLElement;
  private documentCache = new Map<string, TextDocument<LAnnotation>>();

  constructor(options: CodeEditorOptions<LAnnotation> = {}) {
    const {
      theme,
      overflow,
      themeType,
      renderAnnotation,
      overscrollSize = 0,
      workerPoolManager,
      renderPlaceholder,
      ...editorOptions
    } = options;

    super({
      ...editorOptions,
      __createTextDocument: (
        filename: string,
        contents: string,
        languageId: string,
        cacheKey: string | undefined,
        editStack: EditStack<LAnnotation>
      ) => {
        const documentCache = this.documentCache;
        cacheKey = (cacheKey ?? filename) + '(' + languageId + ')';
        if (documentCache.has(cacheKey)) {
          return documentCache.get(cacheKey)!;
        }
        const document = new TextDocument<LAnnotation>(
          filename,
          contents,
          languageId,
          0,
          editStack
        );
        documentCache.set(cacheKey, document);
        return document;
      },
    });

    const virtualizer = new Virtualizer({
      overscrollSize,
      intersectionObserverMargin: overscrollSize * 4,
    });

    this.scrollContainer = document.createElement('div');
    this.fileContainer = document.createElement(DIFFS_TAG_NAME);
    this.fileInstance = new VirtualizedFile<LAnnotation>(
      {
        theme,
        overflow,
        themeType,
        renderAnnotation,
        useTokenTransformer: true,
        disableFileHeader: true,
      },
      virtualizer,
      undefined,
      workerPoolManager
    );

    virtualizer.setup(this.scrollContainer);
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
      if (this.renderPlaceholder != null) {
        const placeholder = this.renderPlaceholder();
        this.scrollContainer.replaceChildren(placeholder);
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

  setContent(
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
}
