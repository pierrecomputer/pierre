export function createAnnotationWrapperNode(slot: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.dataset.annotationSlot = '';
  wrapper.slot = slot;
  wrapper.style.whiteSpace = 'normal';
  return wrapper;
}
