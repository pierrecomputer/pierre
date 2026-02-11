import { notFound, redirect } from 'next/navigation';

export default function FileTreeRedirectPage() {
  if (process.env.NODE_ENV !== 'development') {
    return notFound();
  }
  redirect('/trees-dev');
}
