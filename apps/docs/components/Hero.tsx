import Link from 'next/link';

import Button from './Button';
import styles from './Hero.module.css';
import { IconBook, IconCopyFill } from './icons';

const Hero = () => {
  return (
    <section className={styles.hero}>
      <h1 className={styles.mainTitle}>Precision Diffs</h1>
      <p className={styles.description}>
        Fast, exact diffing for modern apps. Fully open source, built with
        Shiki, insanely customizable, and packed with the features you need.
        Made with love by{' '}
        <Link href="https://pierre.co">The Pierre Computer Company</Link>.
      </p>

      <div className={styles.actions}>
        <button className={styles.codeBtn}>
          <span>npm i @pierre/precision-diffs</span>
          <IconCopyFill size={16} />
        </button>
        <Button.Link href="/docs">
          <IconBook size={16} />
          Documentation
        </Button.Link>
      </div>
    </section>
  );
};

export default Hero;
