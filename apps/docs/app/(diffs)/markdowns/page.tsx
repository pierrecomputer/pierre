import { MarkdownDemo } from './MarkdownDemo';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { pageMetadata } from '@/lib/page-metadata';

export const metadata = pageMetadata({
  title: 'Markdowns, from Pierre',
  description:
    'Streaming Markdown, rendered in WebAssembly. Try live editing, custom React components, and syntax highlighting.',
  path: '/markdowns',
});

export default function MarkdownsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header />
      <main className="py-12 md:py-20">
        <div className="mb-12 max-w-3xl">
          <p className="text-muted-foreground mb-5 font-mono text-xs tracking-widest uppercase">
            Markdowns / from Pierre
          </p>
          <h1 className="text-5xl font-medium tracking-tighter md:text-7xl">
            Words in motion.
          </h1>
          <p className="text-muted-foreground mt-5 max-w-xl text-lg text-pretty">
            Markdown that keeps up with the conversation. Stream a response,
            make it your own, and let the formatting fall into place.
          </p>
        </div>
        <MarkdownDemo />
        <section className="mt-16 grid gap-8 border-t pt-8 md:grid-cols-3">
          <div>
            <h2 className="mb-2 font-medium">Ready as it arrives.</h2>
            <p className="text-muted-foreground text-sm">
              Incomplete emphasis and links settle into place while a response
              streams. Finished blocks keep their place.
            </p>
          </div>
          <div>
            <h2 className="mb-2 font-medium">Your components.</h2>
            <p className="text-muted-foreground text-sm">
              Bring your own headings, links, and code blocks with a familiar
              React component map.
            </p>
          </div>
          <div>
            <h2 className="mb-2 font-medium">A small, capable core.</h2>
            <p className="text-muted-foreground text-sm">
              Tables, task lists, and footnotes from a WAT parser. Add Pierre
              Highlights when your words include code.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
