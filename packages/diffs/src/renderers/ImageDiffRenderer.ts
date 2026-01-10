import type { Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { DEFAULT_THEMES } from '../constants';
import type {
  ChangeTypes,
  FileDiffMetadata,
  ImageDiffMode,
  ImageDiffOptions,
  ImageMetadata,
} from '../types';
import { createFileHeaderElement } from '../utils/createFileHeaderElement';
import { type HastTagNames, createHastElement } from '../utils/hast_utils';

export interface ImageRenderResult {
  containerAST: HASTElement;
  headerAST: HASTElement | undefined;
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
}

export class ImageDiffRenderer {
  constructor(public options: ImageDiffOptions = { theme: DEFAULT_THEMES }) {}

  setOptions(options: ImageDiffOptions): void {
    this.options = options;
  }

  renderDiff(
    fileDiff: FileDiffMetadata,
    oldImageUrl?: string,
    newImageUrl?: string
  ): ImageRenderResult {
    const { type } = fileDiff;
    const { imageDiffMode = 'side-by-side' } = this.options;

    let containerAST: HASTElement;

    switch (type) {
      case 'new':
        containerAST = this.renderNewImage(
          newImageUrl,
          fileDiff.newImageMetadata
        );
        break;
      case 'deleted':
        containerAST = this.renderDeletedImage(
          oldImageUrl,
          fileDiff.oldImageMetadata
        );
        break;
      case 'change':
      case 'rename-changed':
        containerAST = this.renderChangedImage(
          oldImageUrl,
          newImageUrl,
          fileDiff.oldImageMetadata,
          fileDiff.newImageMetadata,
          imageDiffMode
        );
        break;
      case 'rename-pure':
        containerAST = this.renderRenamedImage(
          newImageUrl,
          fileDiff.newImageMetadata
        );
        break;
      default:
        containerAST = this.renderBinaryPlaceholder(type);
    }

    const themeStyles = this.getThemeStyles();

    return {
      containerAST,
      headerAST: this.renderHeader(fileDiff, themeStyles),
      themeStyles,
      baseThemeType: this.getBaseThemeType(),
    };
  }

  private renderNewImage(
    imageUrl: string | undefined,
    metadata: ImageMetadata | undefined
  ): HASTElement {
    if (imageUrl == null) {
      return this.renderBinaryPlaceholder('new');
    }

    return this.createImageDiffContainer('side-by-side', [
      this.createImagePanel('added', imageUrl, metadata, 'Added'),
    ]);
  }

  private renderDeletedImage(
    imageUrl: string | undefined,
    metadata: ImageMetadata | undefined
  ): HASTElement {
    if (imageUrl == null) {
      return this.renderBinaryPlaceholder('deleted');
    }

    return this.createImageDiffContainer('side-by-side', [
      this.createImagePanel('deleted', imageUrl, metadata, 'Deleted'),
    ]);
  }

  private renderChangedImage(
    oldImageUrl: string | undefined,
    newImageUrl: string | undefined,
    oldMetadata: ImageMetadata | undefined,
    newMetadata: ImageMetadata | undefined,
    mode: ImageDiffMode
  ): HASTElement {
    if (oldImageUrl == null && newImageUrl == null) {
      return this.renderBinaryPlaceholder('change');
    }

    if (mode === 'swipe') {
      return this.renderSwipeMode(
        oldImageUrl,
        newImageUrl,
        oldMetadata,
        newMetadata
      );
    }

    return this.renderSideBySideMode(
      oldImageUrl,
      newImageUrl,
      oldMetadata,
      newMetadata
    );
  }

  private renderRenamedImage(
    imageUrl: string | undefined,
    metadata: ImageMetadata | undefined
  ): HASTElement {
    if (imageUrl == null) {
      return this.renderBinaryPlaceholder('rename-pure');
    }

    return this.createImageDiffContainer('side-by-side', [
      this.createImagePanel('new', imageUrl, metadata, 'Renamed'),
    ]);
  }

  private renderSideBySideMode(
    oldImageUrl: string | undefined,
    newImageUrl: string | undefined,
    oldMetadata: ImageMetadata | undefined,
    newMetadata: ImageMetadata | undefined
  ): HASTElement {
    const children: HASTElement[] = [];

    if (oldImageUrl != null) {
      children.push(
        this.createImagePanel('old', oldImageUrl, oldMetadata, 'Before')
      );
    }
    if (newImageUrl != null) {
      children.push(
        this.createImagePanel('new', newImageUrl, newMetadata, 'After')
      );
    }

    return this.createImageDiffContainer('side-by-side', children);
  }

  private renderSwipeMode(
    oldImageUrl: string | undefined,
    newImageUrl: string | undefined,
    oldMetadata: ImageMetadata | undefined,
    newMetadata: ImageMetadata | undefined
  ): HASTElement {
    const children: HASTElement[] = [];

    const swipeContainer = createHastElement({
      tagName: 'div',
      properties: { 'data-swipe-container': '' },
      children: [],
    });

    if (oldImageUrl != null) {
      swipeContainer.children.push(
        createHastElement({
          tagName: 'div',
          properties: { 'data-swipe-layer': 'old' },
          children: [this.createImage(oldImageUrl)],
        })
      );
    }

    if (newImageUrl != null) {
      swipeContainer.children.push(
        createHastElement({
          tagName: 'div',
          properties: { 'data-swipe-layer': 'new' },
          children: [this.createImage(newImageUrl)],
        })
      );
    }

    swipeContainer.children.push(
      createHastElement({
        tagName: 'div',
        properties: { 'data-swipe-handle': '' },
        children: [],
      })
    );

    children.push(swipeContainer);

    const metadataRow = createHastElement({
      tagName: 'div',
      properties: {
        style:
          'display: flex; justify-content: space-between; margin-top: 8px;',
      },
      children: [],
    });

    if (oldMetadata != null) {
      metadataRow.children.push(
        this.createMetadataElement(oldMetadata, 'Before')
      );
    }
    if (newMetadata != null) {
      metadataRow.children.push(
        this.createMetadataElement(newMetadata, 'After')
      );
    }

    if (
      metadataRow.children.length > 0 &&
      this.options.showImageMetadata !== false
    ) {
      children.push(metadataRow);
    }

    return this.createImageDiffContainer('swipe', children);
  }

  private createImageDiffContainer(
    mode: ImageDiffMode,
    children: HASTElement[]
  ): HASTElement {
    return createHastElement({
      tagName: 'div',
      properties: {
        'data-image-diff': '',
        'data-image-diff-mode': mode,
      },
      children: [
        createHastElement({
          tagName: 'div',
          properties: { 'data-image-diff-content': '' },
          children,
        }),
      ],
    });
  }

  private createImagePanel(
    type: 'old' | 'new' | 'added' | 'deleted',
    imageUrl: string,
    metadata: ImageMetadata | undefined,
    label: string
  ): HASTElement {
    const children: HASTElement[] = [
      createHastElement({
        tagName: 'div',
        properties: { 'data-image-label': '' },
        children: [{ type: 'text', value: label }],
      }),
      this.createImage(imageUrl),
    ];

    if (metadata != null && this.options.showImageMetadata !== false) {
      children.push(this.createMetadataElement(metadata));
    }

    return createHastElement({
      tagName: 'div',
      properties: { 'data-image-panel': type },
      children,
    });
  }

  private createImage(imageUrl: string): HASTElement {
    const properties: Record<string, string> = {
      src: imageUrl,
      loading: 'lazy',
    };

    if (this.options.maxImageWidth != null) {
      properties.style = `max-width: ${this.options.maxImageWidth}px;`;
    }

    return createHastElement({
      tagName: 'img' as HastTagNames,
      properties,
      children: [],
    });
  }

  private createMetadataElement(
    metadata: ImageMetadata,
    label?: string
  ): HASTElement {
    const parts: string[] = [];

    if (label != null) {
      parts.push(label + ':');
    }

    if (metadata.width != null && metadata.height != null) {
      parts.push(`${metadata.width} × ${metadata.height}`);
    }

    if (metadata.fileSize != null) {
      parts.push(this.formatFileSize(metadata.fileSize));
    }

    return createHastElement({
      tagName: 'div',
      properties: { 'data-image-metadata': '' },
      children: [{ type: 'text', value: parts.join(' ') }],
    });
  }

  private renderBinaryPlaceholder(changeType: ChangeTypes): HASTElement {
    let message: string;
    switch (changeType) {
      case 'new':
        message = 'Binary file added - provide imageUrl to preview';
        break;
      case 'deleted':
        message = 'Binary file deleted - provide imageUrl to preview';
        break;
      default:
        message = 'Binary file changed - provide imageUrl to preview';
    }

    return createHastElement({
      tagName: 'div',
      properties: { 'data-binary-placeholder': '' },
      children: [
        createHastElement({
          tagName: 'div',
          properties: { 'data-binary-icon': '' },
          children: [{ type: 'text', value: '📁' }],
        }),
        createHastElement({
          tagName: 'div',
          properties: { 'data-binary-text': '' },
          children: [{ type: 'text', value: message }],
        }),
      ],
    });
  }

  private renderHeader(
    fileDiff: FileDiffMetadata,
    themeStyles: string
  ): HASTElement | undefined {
    const { disableFileHeader = false, themeType = 'system' } = this.options;
    if (disableFileHeader) {
      return undefined;
    }
    return createFileHeaderElement({
      fileOrDiff: fileDiff,
      themeStyles,
      themeType: this.getBaseThemeType() ?? themeType,
    });
  }

  private getThemeStyles(): string {
    return '';
  }

  private getBaseThemeType(): 'light' | 'dark' | undefined {
    return undefined;
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  renderFullHTML(result: ImageRenderResult): string {
    return toHtml(result.containerAST);
  }
}
