import { UnresolvedFileHunksRenderer } from '../renderers/UnresolvedFileHunksRenderer';
import type { FileContents, FileDiffMetadata } from '../types';
import { parseMergeConflictDiffFromFile } from '../utils/parseMergeConflictDiffFromFile';
import type { WorkerPoolManager } from '../worker';
import {
  FileDiff,
  type FileDiffHydrationProps,
  type FileDiffOptions,
  type FileDiffRenderProps,
} from './FileDiff';

export interface UnresolvedFileRenderProps<LAnnotation> extends Omit<
  FileDiffRenderProps<LAnnotation>,
  'fileDiff' | 'oldFile' | 'newFile'
> {
  file: FileContents;
}

export interface UnresolvedFileHydrationProps<LAnnotation> extends Omit<
  FileDiffHydrationProps<LAnnotation>,
  'fileDiff' | 'oldFile' | 'newFile'
> {
  file: FileContents;
}

let instanceId = -1;

export class UnresolvedFile<
  LAnnotation = undefined,
> extends FileDiff<LAnnotation> {
  override readonly __id: string = `unresolved-file:${++instanceId}`;

  protected unresolvedFileDiffCache:
    | {
        file: FileContents;
        fileDiff: FileDiffMetadata;
      }
    | undefined;

  constructor(
    options: FileDiffOptions<LAnnotation> = {},
    workerManager?: WorkerPoolManager | undefined,
    isContainerManaged = false
  ) {
    super(
      {
        ...options,
        diffStyle: 'unified',
        lineDiffType: options.lineDiffType ?? 'none',
      },
      workerManager,
      isContainerManaged
    );
  }

  override setOptions(options: FileDiffOptions<LAnnotation> | undefined): void {
    if (options == null) {
      return;
    }
    super.setOptions({
      ...options,
      diffStyle: 'unified',
      lineDiffType: options.lineDiffType ?? 'none',
    });
  }

  protected override createHunksRenderer(
    options: FileDiffOptions<LAnnotation>
  ): UnresolvedFileHunksRenderer<LAnnotation> {
    return new UnresolvedFileHunksRenderer(
      this.getHunksRendererOptions(options),
      this.handleHighlightRender,
      this.workerManager
    );
  }

  override cleanUp(): void {
    this.unresolvedFileDiffCache = undefined;
    super.cleanUp();
  }

  override hydrate(props: UnresolvedFileHydrationProps<LAnnotation>): void {
    const { file, ...rest } = props;
    const fileDiff = this.getOrCreateUnresolvedFileDiff(file);
    super.hydrate({
      ...rest,
      fileDiff,
    });
  }

  override render(props: UnresolvedFileRenderProps<LAnnotation>): boolean {
    const { file, ...rest } = props;
    const fileDiff = this.getOrCreateUnresolvedFileDiff(file);
    return super.render({
      ...rest,
      fileDiff,
    });
  }

  private getOrCreateUnresolvedFileDiff(file: FileContents): FileDiffMetadata {
    const cache = this.unresolvedFileDiffCache;
    if (cache != null && cache.file === file) {
      return cache.fileDiff;
    }
    const { fileDiff } = parseMergeConflictDiffFromFile(file);
    this.unresolvedFileDiffCache = {
      file,
      fileDiff,
    };
    return fileDiff;
  }
}
