import { preloadFileTree } from '@pierre/trees/ssr';

import { dragDropOptions } from './demo-data';
import { DragDropSectionClient } from './DragDropSectionClient';

const prerenderedHTML = preloadFileTree({
  ...dragDropOptions(['package.json']),
  id: 'drag-drop-demo-locked',
}).shadowHtml;

export function DragDropSection() {
  return <DragDropSectionClient prerenderedHTML={prerenderedHTML} />;
}
