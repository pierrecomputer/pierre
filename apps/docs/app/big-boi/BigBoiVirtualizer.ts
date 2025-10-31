import {
  FileDiff,
  type FileDiffMetadata,
  type ParsedPatch,
} from '@pierre/precision-diffs';

const DIFF_OPTIONS = {
  theme: 'pierre-dark',
  // diffStyle: 'unified',
};
const LINE_HEIGHT = 20;
const LINE_HEADER_HEIGHT = 44;
const HUNK_SEPARATOR_HEIGHT = 30;
const FILE_GAP = 8;
const FILE_BOTTOM_PADDING = 8;
const ENABLE_RENDERING = true;

interface RenderedItems {
  instance: FileDiff;
  element: HTMLElement;
}

export interface VirtualizedFileMetadata extends FileDiffMetadata {
  unifiedTop: number;
  splitTop: number;
}

export class BigBoiVirtualizer {
  private files: VirtualizedFileMetadata[] = [];
  private totalHeightUnified = 0;
  private totalHeightSplit = 0;
  private instances: Map<VirtualizedFileMetadata, RenderedItems> = new Map();

  constructor(private container: HTMLElement) {}

  reset() {
    this.files.length = 0;
    this.totalHeightSplit = 0;
    this.totalHeightUnified = 0;
    for (const [, { instance }] of Array.from(this.instances)) {
      instance.cleanUp();
    }
    this.instances.clear();
    this.container.innerHTML = '';
  }

  addFiles(parsedPatches: ParsedPatch[]) {
    // Hacks to make the big boi smaller...
    // parsedPatches.length = 1;
    // parsedPatches[0].files.length = 40;
    // console.log('ZZZZ - before trim', parsedPatches[0].files.length);
    // const file = parsedPatches[0].files[7];
    // parsedPatches[0].files.length = 0;
    // parsedPatches[0].files.push(file);

    for (const patch of parsedPatches) {
      for (const file of patch.files) {
        if (this.files.length > 0) {
          this.totalHeightUnified += FILE_GAP;
          this.totalHeightSplit += FILE_GAP;
        }
        // It would be about twice as fast to just straight ts-ignore and
        // manipulate this, mb we do that?
        this.files.push({
          ...file,
          unifiedTop: this.totalHeightUnified,
          splitTop: this.totalHeightSplit,
        });

        this.totalHeightUnified += LINE_HEADER_HEIGHT;
        this.totalHeightSplit += LINE_HEADER_HEIGHT;
        this.totalHeightUnified += file.unifiedLineCount * LINE_HEIGHT;
        this.totalHeightSplit += file.splitLineCount * LINE_HEIGHT;

        const hunkCount = file.hunks.length;
        const [firstHunk] = file.hunks;
        if (firstHunk != null) {
          if (firstHunk.additionStart > 1 || firstHunk.deletedStart > 1) {
            let hunkSize =
              (HUNK_SEPARATOR_HEIGHT + FILE_GAP * 2) * (hunkCount - 1);
            hunkSize += HUNK_SEPARATOR_HEIGHT + FILE_GAP;
            this.totalHeightSplit += hunkSize;
            this.totalHeightUnified += hunkSize;
          } else {
            const hunkSize =
              (HUNK_SEPARATOR_HEIGHT + FILE_GAP * 2) * (hunkCount - 1);
            this.totalHeightSplit += hunkSize;
            this.totalHeightUnified += hunkSize;
          }
        }
        if (hunkCount > 0) {
          this.totalHeightUnified += FILE_BOTTOM_PADDING;
          this.totalHeightSplit += FILE_BOTTOM_PADDING;
        }
      }
    }
  }

  render() {
    this.setupContainer();
    if (!ENABLE_RENDERING) return;
    for (const fileDiff of this.files) {
      const instance = new FileDiff(DIFF_OPTIONS, true);
      const fileContainer = document.createElement('file-diff');
      this.instances.set(fileDiff, { element: fileContainer, instance });
      fileContainer.style.top = `${fileDiff.splitTop}px`;
      // NOTE(amadeus): We gotta append first to ensure file ordering is
      // correct... but i guess maybe doesn't matter because we are positioning shit
      this.container.appendChild(fileContainer);
      void instance.render({ fileDiff, fileContainer });
    }
  }

  private setupContainer() {
    this.container.style.height = `${this.totalHeightSplit + FILE_GAP}px`;
  }
}
