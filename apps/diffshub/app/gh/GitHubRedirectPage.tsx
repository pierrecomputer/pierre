import { permanentRedirect } from 'next/navigation';

export function GitHubRedirectPage() {
  permanentRedirect('https://diffshub.com');
}
