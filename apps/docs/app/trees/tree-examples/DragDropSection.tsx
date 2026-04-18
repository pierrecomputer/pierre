import { dragDropOptions } from './demo-data';
import { DragDropSectionClient } from './DragDropSectionClient';
import { preloadFileTree } from '@/lib/treesCompat';

const prerenderedHTML = preloadFileTree({
  ...dragDropOptions(['package.json']),
  id: 'drag-drop-demo-locked',
}).shadowHtml;

export function DragDropSection() {
  return <DragDropSectionClient prerenderedHTML={prerenderedHTML} />;
}
