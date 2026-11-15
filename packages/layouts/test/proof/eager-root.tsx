// The eager module of an app that imports the root entry at once, for a saved
// tree, and the React entry only behind a dynamic import, as chat-bb's thread
// page does. The eager chunk must hold none of the view.
import { parseStoredLayoutTree } from '@pierre/layouts';

export const savedRoot = (text: string) =>
  parseStoredLayoutTree(JSON.parse(text)).root;

export const loadView = () => import('./lazy-view');
