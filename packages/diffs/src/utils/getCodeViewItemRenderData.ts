import type {
  CodeViewRenderedDiffItem,
  CodeViewRenderedFileItem,
  CodeViewRenderedItem,
} from '../components/CodeView';
import type { FileRenderData } from '../components/File';
import type { FileDiffRenderData } from '../components/FileDiff';

// Return the data a rendered item's next render will display. CodeView applies
// item changes to the instance before rendering it, so the instance's own
// input describes that render.
export function getCodeViewItemRenderData<LAnnotation, Caret>(
  renderedItem: CodeViewRenderedDiffItem<LAnnotation, Caret>
): FileDiffRenderData<LAnnotation>;
export function getCodeViewItemRenderData<LAnnotation, Caret>(
  renderedItem: CodeViewRenderedFileItem<LAnnotation, Caret>
): FileRenderData<LAnnotation>;
export function getCodeViewItemRenderData<LAnnotation, Caret>(
  renderedItem: CodeViewRenderedItem<LAnnotation, Caret>
): FileDiffRenderData<LAnnotation> | FileRenderData<LAnnotation>;
export function getCodeViewItemRenderData<LAnnotation, Caret>(
  renderedItem: CodeViewRenderedItem<LAnnotation, Caret>
): FileDiffRenderData<LAnnotation> | FileRenderData<LAnnotation> {
  if (renderedItem.type === 'diff') {
    const { instance, item } = renderedItem;
    return instance.__getNextRenderData({
      fileDiff: instance.fileDiff ?? item.fileDiff,
      lineAnnotations: undefined,
    });
  }
  const { instance, item } = renderedItem;
  return instance.__getNextRenderData({
    file: instance.file ?? item.file,
    lineAnnotations: undefined,
  });
}
