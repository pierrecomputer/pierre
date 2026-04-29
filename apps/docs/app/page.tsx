import DiffsHome from './(diffs)/_home/Home';
// Build-time dispatcher: each site (NEXT_PUBLIC_SITE=diffs|trees|diffshub)
// renders its own product's home page at `/`. All modules are imported
// statically so webpack can dead-code-eliminate the inactive branches when
// `process.env.NEXT_PUBLIC_SITE` is statically replaced at build.
//
// Page-level metadata is intentionally not re-exported here: the per-site
// title, description, icons, and OG/twitter images come from
// `app/layout.tsx`, which already reads `NEXT_PUBLIC_SITE`.
import DiffshubHome from './(diffshub)/_home/Home';
import TreesHome from './(trees)/_home/Home';

const SITE = process.env.NEXT_PUBLIC_SITE;

const Page =
  SITE === 'trees' ? TreesHome : SITE === 'diffshub' ? DiffshubHome : DiffsHome;
export default Page;
