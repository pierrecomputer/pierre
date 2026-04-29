// Build-time dispatcher for `/docs`: see app/page.tsx for rationale.
// Diffshub has no docs (yet), so on that site `/docs` permanently redirects
// to the home page rather than rendering a separate doc shell.
import { redirect } from 'next/navigation';

import DiffsDocsPage, {
  metadata as diffsDocsMetadata,
} from '../(diffs)/_docs/DocsPage';
import TreesDocsPage, {
  metadata as treesDocsMetadata,
} from '../(trees)/_docs/DocsPage';

const SITE = process.env.NEXT_PUBLIC_SITE;
const isTrees = SITE === 'trees';
const isDiffshub = SITE === 'diffshub';

export const metadata = isTrees ? treesDocsMetadata : diffsDocsMetadata;

function DiffshubDocsPage(): never {
  redirect('/');
}

const Page = isDiffshub
  ? DiffshubDocsPage
  : isTrees
    ? TreesDocsPage
    : DiffsDocsPage;
export default Page;
