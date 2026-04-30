import { redirect } from 'next/navigation';

import { getPullRequestPath } from './_components/utils';

// JS-off fallback for the DiffsHub home form. The form posts here as
// `/view?url=<encoded>`; we validate the URL and 307 the user to the
// pretty path-style route (`/view/owner/repo/pull/number`) so the address
// bar never settles on the percent-encoded query form. Bad/missing URLs
// bounce to `/` where the form lives.
export default async function DiffshubViewRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  const { url: rawUrl } = await searchParams;
  const candidate = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl;
  const trimmed = candidate?.trim();
  const prPath = trimmed != null ? getPullRequestPath(trimmed) : undefined;
  if (prPath == null) {
    redirect('/');
  }
  // `getPullRequestPath` returns the URL pathname (e.g. "/twbs/bootstrap/pull/42369"),
  // which is exactly the suffix the path-style route expects under `/view`.
  // Strip a trailing `.patch` since the dynamic segment is just the PR number.
  const cleanPrPath = prPath.replace(/\.patch$/, '');
  redirect(`/view${cleanPrPath}`);
}
