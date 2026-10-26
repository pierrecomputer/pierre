import { permanentRedirect } from 'next/navigation';

export default function MarkdownsRedirect() {
  permanentRedirect('/words');
}
