import Footer from '@/components/Footer';
import { preloadFileDiff } from '@pierre/diffs/ssr';

import { ExamplesLayout } from './ExamplesLayout';
import { AICodeReview } from './ai-code-review/AICodeReview';
import { AI_CODE_REVIEW_EXAMPLE } from './ai-code-review/constants';
import { FullCustomHeader } from './custom-chrome/FullCustomHeader';
import { FULL_CUSTOM_HEADER_EXAMPLE } from './custom-chrome/constants';
import { GitBlameView } from './git-blame/GitBlameView';
import { GIT_BLAME_EXAMPLE } from './git-blame/constants';
import { HoverActions } from './hover-actions/HoverActions';
import { HOVER_ACTIONS_EXAMPLE } from './hover-actions/constants';
import { PRReview } from './pr-review/PRReview';
import { PR_REVIEW_EXAMPLES } from './pr-review/constants';
import { ThemeCarousel } from './theme-carousel/ThemeCarousel';
import { THEME_CAROUSEL_EXAMPLE } from './theme-carousel/constants';

export default async function ExamplesPage() {
  const [
    customHeaderDiff,
    aiCodeReviewDiff,
    gitBlameDiff,
    themeCarouselDiff,
    hoverActionsDiff,
    ...prReviewDiffs
  ] = await Promise.all([
    preloadFileDiff(FULL_CUSTOM_HEADER_EXAMPLE),
    preloadFileDiff(AI_CODE_REVIEW_EXAMPLE),
    preloadFileDiff(GIT_BLAME_EXAMPLE),
    preloadFileDiff(THEME_CAROUSEL_EXAMPLE),
    preloadFileDiff(HOVER_ACTIONS_EXAMPLE),
    ...PR_REVIEW_EXAMPLES.map((ex) => preloadFileDiff(ex)),
  ]);

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <ExamplesLayout>
        <div className="min-w-0">
          <section className="space-y-6 py-6">
            <div className="space-y-3">
              <h1 className="text-muted-foreground max-w-xl text-lg">
                A collection of examples showcasing how you can customize and
                extend <code className="text-foreground">@pierre/diffs</code>.
              </h1>
            </div>
          </section>

          <section className="space-y-20 pb-16">
            <div id="theme-carousel" className="scroll-mt-24">
              <ThemeCarousel prerenderedDiff={themeCarouselDiff} />
            </div>
            <div id="custom-chrome" className="scroll-mt-24">
              <FullCustomHeader prerenderedDiff={customHeaderDiff} />
            </div>
            <div id="hover-actions" className="scroll-mt-24">
              <HoverActions prerenderedDiff={hoverActionsDiff} />
            </div>
            <div id="ai-code-review" className="scroll-mt-24">
              <AICodeReview prerenderedDiff={aiCodeReviewDiff} />
            </div>
            <div id="pr-review" className="scroll-mt-24">
              <PRReview prerenderedDiffs={prReviewDiffs} />
            </div>
            <div id="git-blame" className="scroll-mt-24">
              <GitBlameView prerenderedDiff={gitBlameDiff} />
            </div>
          </section>
        </div>
      </ExamplesLayout>

      <Footer />
    </div>
  );
}
