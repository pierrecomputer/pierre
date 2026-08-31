import { ResponsivenessDemoClient } from '../_demos/ResponsivenessDemoClient';
import { pageMetadata } from '@/lib/page-metadata';

export const metadata = pageMetadata({
  title: 'Responsiveness demo — Pierre Trees',
  description:
    'How @pierre/trees keeps scrolling, keyboard navigation, and search interactive while the tree is being mutated underneath.',
  path: '/trees-dev/responsiveness',
});

export default function TreesDevResponsivenessPage() {
  return <ResponsivenessDemoClient />;
}
