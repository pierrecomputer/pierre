import type { FileContents, FileDiffMetadata } from '../types';
import { parseMergeConflictDiffFromFile } from '../utils/parseMergeConflictDiffFromFile';
import type { WorkerPoolManager } from '../worker';
import {
  FileDiff,
  type FileDiffHydrationProps,
  type FileDiffOptions,
  type FileDiffRenderProps,
} from './FileDiff';

export interface MergeConflictDiffRenderProps<LAnnotation> extends Omit<
  FileDiffRenderProps<LAnnotation>,
  'fileDiff' | 'oldFile' | 'newFile'
> {
  file: FileContents;
}

export interface MergeConflictDiffHydrationProps<LAnnotation> extends Omit<
  FileDiffHydrationProps<LAnnotation>,
  'fileDiff' | 'oldFile' | 'newFile'
> {
  file: FileContents;
}

let instanceId = -1;

export class MergeConflictDiff<
  LAnnotation = undefined,
> extends FileDiff<LAnnotation> {
  override readonly __id: string = `merge-conflict-diff:${++instanceId}`;

  protected mergeConflictDiffCache:
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
        mergeConflictStyling: true,
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
      mergeConflictStyling: true,
      lineDiffType: options.lineDiffType ?? 'none',
    });
  }

  override cleanUp(): void {
    this.mergeConflictDiffCache = undefined;
    super.cleanUp();
  }

  override hydrate(props: MergeConflictDiffHydrationProps<LAnnotation>): void {
    const { file, ...rest } = props;
    const fileDiff = this.getOrCreateMergeConflictDiff(file);
    super.hydrate({
      ...rest,
      fileDiff,
    });
  }

  override render(props: MergeConflictDiffRenderProps<LAnnotation>): boolean {
    const { file, ...rest } = props;
    const fileDiff = this.getOrCreateMergeConflictDiff(file);
    return super.render({
      ...rest,
      fileDiff,
    });
  }

  private getOrCreateMergeConflictDiff(file: FileContents): FileDiffMetadata {
    const cache = this.mergeConflictDiffCache;
    if (cache != null && cache.file === file) {
      return cache.fileDiff;
    }
    const { fileDiff } = parseMergeConflictDiffFromFile(file);
    this.mergeConflictDiffCache = {
      file,
      fileDiff,
    };
    return fileDiff;
  }
}
