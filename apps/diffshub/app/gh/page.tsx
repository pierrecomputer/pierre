import { permanentRedirect } from 'next/navigation';

export default function GitHubRedirectPage() {
  permanentRedirect('https://diffshub.com');
}
