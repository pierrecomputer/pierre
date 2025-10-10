import Button from '@/components/Button';
import ButtonGroup from '@/components/ButtonGroup';
import Header from '@/components/Header';
import Hero from '@/components/Hero';
import styles from '@/components/Layout.module.css';
import {
  IconChevronSm,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
  IconComment,
  IconCopyFill,
  IconParagraph,
  IconSquircleSpeechText,
  IconSymbolDiffstat,
  IconType,
  IconWordWrap,
} from '@/components/icons';
import '@/styles/tokens.css';

import IconSprite from './IconSprite';
// import './home.css';
import './css/index.css';
import { SplitUnified } from './diff-examples/SplitUnified';

export default function Home() {
  return (
    <div className={styles.container}>
      <Header />

      <Hero />

      <section className={styles.features}>
        <h2>Blends right in with your brand</h2>
        <p>
          Precision Diffs are built using minimal, but highly configurable
          vanilla CSS. Customize everything with a handful of CSS variables that
          serve as design tokens. More of a Tailwind or shadcn/ui team? No
          problem, pass classes directly into each component for full control.
        </p>
      </section>

      <section className={styles.features}>
        <h2>Everything but the kitchen sink</h2>
        <p>
          Precision Diffs are packed full of the features you need with more
          planned for future releases. Choose any Shiki theme and we
          automatically adapt it, configure diffs as stacked or split, pick from
          multiple diff visual styles, and much more.
        </p>

        <SplitUnified />

        <h3>Adapts to any Shiki theme</h3>
        <p className={styles.fsSm}>
          Precision Diffs are built with Shiki for syntax highlighting and
          general theming. Our components automatically adapt to blend in with
          your theme selection, including across color modes.
        </p>

        <div className={styles.hstack}>
          <Button variant="active">
            <IconColorDark />
            GitHub Dark
            <IconChevronSm />
          </Button>

          <Button variant="active">
            <IconColorLight />
            GitHub Light
            <IconChevronSm />
          </Button>

          <ButtonGroup>
            <Button variant="active">
              <IconColorAuto />
              Auto
            </Button>
            <Button>
              <IconColorLight />
              Light
            </Button>
            <Button>
              <IconColorDark />
              Dark
            </Button>
          </ButtonGroup>
        </div>

        <h3>Choose how changes are styled</h3>
        <p className="fs-sm">
          Your diffs, your choice. Render changed lines with classic diff
          indicators (+/–), full-width background colors, or vertical bars. You
          can even highlight inline changes—character or word based—and toggle
          line wrapping, hide numbers, and more.
        </p>
        <div className="hstack">
          <ButtonGroup>
            <Button variant="active">
              <IconSymbolDiffstat />
              Classic
            </Button>
            <Button>
              <IconSymbolDiffstat />
              Background
            </Button>
            <Button>
              <IconSymbolDiffstat />
              Bar
            </Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button variant="active">
              <IconSymbolDiffstat />
              Inline
            </Button>
            <Button>
              <IconSymbolDiffstat />
              Whole line
            </Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button variant="active">
              <IconWordWrap />
              Wrap
            </Button>
            <Button>
              <IconParagraph />
              No wrap
            </Button>
          </ButtonGroup>
        </div>

        <h3>Bring your own fonts</h3>
        <p className="fs-sm">
          Precision Diffs is adaptable to any font, font-size, line-height, and
          even font-feature-settings you may have set. Configure font options
          with your preferred CSS method globally or on a per-component basis.
        </p>
        <div className="hstack">
          <Button variant="active">
            <IconType />
            Geist Mono
            <IconChevronSm />
          </Button>
          <Button variant="active">
            12px
            <IconChevronSm />
          </Button>
          <Button variant="active">
            20px
            <IconChevronSm />
          </Button>
          <input placeholder="Font feature settings" />
        </div>

        <h3>Pre-built React and JavaScript components</h3>
        <p className="fs-sm">
          No two codebases are alike, so we give you the freedom to implement
          Precision Diffs however you like. Components are logically
          separated—file wrapper, header, hunk, and more—and are all available
          in React or JavaScript versions.
        </p>
        <div className="d-grid cols-2">
          <div className="codeblock" data-theme="dark" lang="React">
            <button>
              <IconCopyFill />
            </button>
            <pre>{`import {
  uiFileWrapper,
  uiHiddenLines,
  uiDivider,
  uiHunk
  } from @pierre/precision-diffs;`}</pre>
          </div>

          <div className="codeblock" data-theme="dark" lang="JavaScript">
            <button>
              <IconCopyFill />
            </button>
            <pre>{`import {
  uiFileWrapper,
  uiHiddenLines,
  uiDivider,
  uiHunk
} from './@pierrejs/precision-diffs/index.js';`}</pre>
          </div>
        </div>

        <h3>Comments &amp; Annotations</h3>
        <p className="fs-sm">
          Precision Diffs provides a flexible annotation framework for injecting
          additional content and context into your diffs. Use it to render line
          comments, annotations from CI jobs, and other third party content.
        </p>
        <div className="hstack">
          <ButtonGroup>
            <Button variant="active">
              <IconComment />
              Comments
            </Button>
            <Button>
              <IconSquircleSpeechText />
              Annotations
            </Button>
          </ButtonGroup>
        </div>

        <h3>Diff arbitrary files</h3>
        <p className="fs-sm">
          In addition to rendering standard Git diffs and patches, you can pass
          any two files in Precision Diffs and get a diff between them. This is
          especially useful when comparing across generative snapshots where
          linear history isn’t always available.
        </p>
      </section>

      <section className="features">
        <h2>Migrate to Precision Diffs</h2>
        <p>
          Already using git-diff-viewer? Learn how to migrate your diff
          rendering to Precision Diffs.
        </p>
      </section>

      <section className="features">
        <h2>With love from The Pierre Computer Company</h2>
        <p>
          Our team has decades of cumulative experience in open source,
          developer tools, and more. We’ve worked on projects like Coinbase,
          GitHub, Bootstrap, Twitter, Medium, and more. This stuff is our bread
          and butter, and we’d love to share it with you.
        </p>
      </section>

      <IconSprite />

      <div className="color-palette">
        <h2>Color Palette</h2>

        <h3>Major Hues</h3>
        <div className="major-hues">
          <div className="hue-swatch">
            <div
              className="hue-color"
              style={{ backgroundColor: 'var(--color-red)' }}
            ></div>
            <div className="hue-name">Red</div>
          </div>
          <div className="hue-swatch">
            <div
              className="hue-color"
              style={{ backgroundColor: 'var(--color-orange)' }}
            ></div>
            <div className="hue-name">Orange</div>
          </div>
          <div className="hue-swatch">
            <div
              className="hue-color"
              style={{ backgroundColor: 'var(--color-yellow)' }}
            ></div>
            <div className="hue-name">Yellow</div>
          </div>
          <div className="hue-swatch">
            <div
              className="hue-color"
              style={{ backgroundColor: 'var(--color-green)' }}
            ></div>
            <div className="hue-name">Green</div>
          </div>
          <div className="hue-swatch">
            <div
              className="hue-color"
              style={{ backgroundColor: 'var(--color-mint)' }}
            ></div>
            <div className="hue-name">Mint</div>
          </div>
          <div className="hue-swatch">
            <div
              className="hue-color"
              style={{ backgroundColor: 'var(--color-teal)' }}
            ></div>
            <div className="hue-name">Teal</div>
          </div>
          <div className="hue-swatch">
            <div
              className="hue-color"
              style={{ backgroundColor: 'var(--color-cyan)' }}
            ></div>
            <div className="hue-name">Cyan</div>
          </div>
          <div className="hue-swatch">
            <div
              className="hue-color"
              style={{ backgroundColor: 'var(--color-blue)' }}
            ></div>
            <div className="hue-name">Blue</div>
          </div>
          <div className="hue-swatch">
            <div
              className="hue-color"
              style={{ backgroundColor: 'var(--color-indigo)' }}
            ></div>
            <div className="hue-name">Indigo</div>
          </div>
          <div className="hue-swatch">
            <div
              className="hue-color"
              style={{ backgroundColor: 'var(--color-purple)' }}
            ></div>
            <div className="hue-name">Purple</div>
          </div>
          <div className="hue-swatch">
            <div
              className="hue-color"
              style={{ backgroundColor: 'var(--color-pink)' }}
            ></div>
            <div className="hue-name">Pink</div>
          </div>
          <div className="hue-swatch">
            <div
              className="hue-color"
              style={{ backgroundColor: 'var(--color-brown)' }}
            ></div>
            <div className="hue-name">Brown</div>
          </div>
        </div>

        <h3>Color Scales</h3>
        <div className="color-scale">
          <div className="color-scale-row">
            <div className="color-scale-name">Red Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-red050)' }}
                data-shade="050"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-red100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-red200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-red300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-red400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-red500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-red600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-red700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-red800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-red900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-red950)' }}
                data-shade="950"
              ></div>
            </div>
          </div>

          <div className="color-scale-row">
            <div className="color-scale-name">Orange Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-orange050)' }}
                data-shade="050"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-orange100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-orange200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-orange300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-orange400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-orange500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-orange600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-orange700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-orange800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-orange900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-orange950)' }}
                data-shade="950"
              ></div>
            </div>
          </div>

          <div className="color-scale-row">
            <div className="color-scale-name">Yellow Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-yellow050)' }}
                data-shade="050"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-yellow100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-yellow200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-yellow300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-yellow400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-yellow500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-yellow600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-yellow700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-yellow800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-yellow900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-yellow950)' }}
                data-shade="950"
              ></div>
            </div>
          </div>

          <div className="color-scale-row">
            <div className="color-scale-name">Green Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-green050)' }}
                data-shade="050"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-green100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-green200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-green300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-green400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-green500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-green600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-green700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-green800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-green900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-green950)' }}
                data-shade="950"
              ></div>
            </div>
          </div>

          <div className="color-scale-row">
            <div className="color-scale-name">Mint Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-mint050)' }}
                data-shade="050"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-mint100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-mint200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-mint300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-mint400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-mint500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-mint600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-mint700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-mint800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-mint900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-mint950)' }}
                data-shade="950"
              ></div>
            </div>
          </div>

          <div className="color-scale-row">
            <div className="color-scale-name">Teal Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-teal050)' }}
                data-shade="050"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-teal100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-teal200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-teal300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-teal400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-teal500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-teal600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-teal700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-teal800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-teal900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-teal950)' }}
                data-shade="950"
              ></div>
            </div>
          </div>

          <div className="color-scale-row">
            <div className="color-scale-name">Cyan Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-cyan050)' }}
                data-shade="050"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-cyan100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-cyan200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-cyan300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-cyan400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-cyan500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-cyan600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-cyan700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-cyan800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-cyan900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-cyan950)' }}
                data-shade="950"
              ></div>
            </div>
          </div>

          <div className="color-scale-row">
            <div className="color-scale-name">Blue Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-blue050)' }}
                data-shade="050"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-blue100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-blue200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-blue300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-blue400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-blue500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-blue600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-blue700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-blue800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-blue900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-blue950)' }}
                data-shade="950"
              ></div>
            </div>
          </div>

          <div className="color-scale-row">
            <div className="color-scale-name">Indigo Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-indigo050)' }}
                data-shade="050"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-indigo100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-indigo200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-indigo300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-indigo400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-indigo500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-indigo600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-indigo700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-indigo800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-indigo900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-indigo950)' }}
                data-shade="950"
              ></div>
            </div>
          </div>

          <div className="color-scale-row">
            <div className="color-scale-name">Purple Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-purple050)' }}
                data-shade="050"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-purple100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-purple200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-purple300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-purple400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-purple500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-purple600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-purple700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-purple800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-purple900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-purple950)' }}
                data-shade="950"
              ></div>
            </div>
          </div>

          <div className="color-scale-row">
            <div className="color-scale-name">Pink Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-pink050)' }}
                data-shade="050"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-pink100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-pink200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-pink300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-pink400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-pink500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-pink600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-pink700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-pink800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-pink900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-pink950)' }}
                data-shade="950"
              ></div>
            </div>
          </div>

          <div className="color-scale-row">
            <div className="color-scale-name">Brown Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-brown050)' }}
                data-shade="050"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-brown100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-brown200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-brown300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-brown400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-brown500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-brown600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-brown700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-brown800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-brown900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-brown950)' }}
                data-shade="950"
              ></div>
            </div>
          </div>

          <div className="color-scale-row">
            <div className="color-scale-name">Gray Scale</div>
            <div className="color-scale-swatches">
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray020)' }}
                data-shade="020"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray040)' }}
                data-shade="040"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray060)' }}
                data-shade="060"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray080)' }}
                data-shade="080"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray100)' }}
                data-shade="100"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray200)' }}
                data-shade="200"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray300)' }}
                data-shade="300"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray400)' }}
                data-shade="400"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray500)' }}
                data-shade="500"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray600)' }}
                data-shade="600"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray700)' }}
                data-shade="700"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray800)' }}
                data-shade="800"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray900)' }}
                data-shade="900"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray920)' }}
                data-shade="920"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray940)' }}
                data-shade="940"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray960)' }}
                data-shade="960"
              ></div>
              <div
                className="color-scale-swatch"
                style={{ backgroundColor: 'var(--color-gray980)' }}
                data-shade="980"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div className="icon-showcase">
        <svg width="16" height="16">
          <use xlinkHref={'#pjs-icon-arrow-short'} />
        </svg>
        <svg width="16" height="16">
          <use xlinkHref={'#pjs-icon-arrow-up-right'} />
        </svg>
        <svg width="16" height="16">
          <use xlinkHref={'#pjs-icon-book'} />
        </svg>
        <svg width="16" height="16">
          <use xlinkHref={'#pjs-icon-diffstat'} />
        </svg>
        <svg width="16" height="16">
          <use xlinkHref={'#pjs-icon-git-added'} />
        </svg>
        <svg width="16" height="16">
          <use xlinkHref={'#pjs-icon-git-deleted'} />
        </svg>
        <svg width="16" height="16">
          <use xlinkHref={'#pjs-icon-git-ignored'} />
        </svg>
        <svg width="16" height="16">
          <use xlinkHref={'#pjs-icon-git-modified'} />
        </svg>
        <svg width="16" height="16">
          <use xlinkHref={'#pjs-icon-git-moved'} />
        </svg>
        <svg width="16" height="16">
          <use xlinkHref={'#pjs-icon-git-ref'} />
        </svg>
        <svg width="16" height="16">
          <use xlinkHref={'#pjs-icon-github'} />
        </svg>
      </div>
    </div>
  );
}
