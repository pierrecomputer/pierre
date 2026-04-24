// Build-time dispatcher for `/docs`: see app/page.tsx for rationale.
import DiffsDocsPage, {
  metadata as diffsDocsMetadata,
} from '../(diffs)/_docs/DocsPage';
import TreesDocsPage, {
  metadata as treesDocsMetadata,
} from '../(trees)/_docs/DocsPage';

const isTrees = process.env.NEXT_PUBLIC_SITE === 'trees';

export const metadata = isTrees ? treesDocsMetadata : diffsDocsMetadata;

const Page = isTrees ? TreesDocsPage : DiffsDocsPage;
export default Page;
