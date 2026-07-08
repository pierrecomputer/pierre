import { DIFFS_TAG_NAME } from '../constants';
import { Editor, type EditorOptions } from '../editor';
import type {
  DiffsThemeNames,
  FileContents,
  LineAnnotation,
  ThemesType,
  ThemeTypes,
} from '../types';
import type { WorkerPoolManager } from '../worker';
import { VirtualizedFile } from './VirtualizedFile';
import { Virtualizer } from './Virtualizer';

export interface CodeEditorOptions<
  LAnnotation,
> extends EditorOptions<LAnnotation> {
  theme?: DiffsThemeNames | ThemesType;
  overflow?: 'scroll' | 'wrap'; // 'scroll' is default
  themeType?: ThemeTypes; // 'system' is default
  overscrollSize?: number;
  workerPoolManager?: WorkerPoolManager;
  renderPlaceholder?: () => HTMLElement;
}

export class CodeEditor<LAnnotation> extends Editor<LAnnotation> {
  private file?: FileContents;
  private root?: HTMLElement;
  private scrollContainer: HTMLElement;
  private fileContainer: HTMLElement;
  private fileInstance: VirtualizedFile<LAnnotation>;
  private renderPlaceholder?: () => HTMLElement;

  constructor(options: CodeEditorOptions<LAnnotation> = {}) {
    const {
      theme,
      overflow,
      themeType,
      overscrollSize = 0,
      workerPoolManager,
      renderPlaceholder,
      ...editorOptions
    } = options;
    super(editorOptions);

    const virtualizer = new Virtualizer({
      overscrollSize,
      intersectionObserverMargin: overscrollSize * 4,
    });

    this.scrollContainer = document.createElement('div');
    this.fileContainer = document.createElement(DIFFS_TAG_NAME);
    this.fileInstance = new VirtualizedFile<LAnnotation>(
      {
        theme: theme,
        overflow: overflow,
        themeType: themeType,
        useTokenTransformer: true,
        disableFileHeader: true,
      },
      virtualizer,
      undefined,
      workerPoolManager
    );

    virtualizer.setup(this.scrollContainer);
    Object.assign(this.scrollContainer.style, {
      width: '100%',
      height: '100%',
      minHeight: '0',
      overflow: 'auto',
    });
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
    this.root = root;
    this.root.appendChild(this.scrollContainer);

    if (file == null) {
      if (this.renderPlaceholder != null) {
        const placeholder = this.renderPlaceholder();
        this.scrollContainer.replaceChildren(placeholder);
      }
      return;
    }

    this.file = file;
    this.scrollContainer.replaceChildren(this.fileContainer);
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
    this.file = file;
    this.scrollContainer.replaceChildren(this.fileContainer);
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
