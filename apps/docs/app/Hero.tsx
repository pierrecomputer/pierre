'use client';

import { IconBook, IconCheck, IconCopyFill } from '@pierre/icons';
import Link from 'next/link';
import { useState } from 'react';

import diffsPackageJson from '../../../packages/diffs/package.json';
import treesPackageJson from '../../../packages/trees/package.json';
import { getProductConfig, type ProductId } from './product-config';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface HeroProps {
  productId: ProductId;
}

export function Hero({ productId }: HeroProps) {
  const [copied, setCopied] = useState(false);
  const product = getProductConfig(productId);
  const packageJson =
    productId === 'diffs' ? diffsPackageJson : treesPackageJson;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(product.installCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 5000);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };

  return (
    <section className="flex max-w-3xl flex-col gap-3 py-20 lg:max-w-4xl">
      <HeroIcon productId={productId} />

      <h1 className="text-4xl font-semibold tracking-tight md:text-5xl lg:text-6xl">
        {product.tagline}
      </h1>
      <p className="text-md text-muted-foreground mb-2 max-w-[740px] text-pretty md:text-lg lg:text-xl">
        <code>{product.packageName}</code>{' '}
        {product.description.replace(`${product.packageName} is `, 'is ')} Made
        with love by{' '}
        <Link
          target="_blank"
          href="https://pierre.computer"
          className="hover:text-foreground muted-foreground hover:decoration-foreground underline decoration-[1px] underline-offset-4 transition-colors"
        >
          The Pierre Computer Company
        </Link>
        .
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => void copyToClipboard()}
              className="inline-flex items-center gap-4 rounded-lg bg-neutral-900 px-5 py-3 font-mono text-sm tracking-tight text-white transition-colors hover:bg-neutral-800 md:text-base dark:border dark:border-white/20 dark:bg-black dark:hover:border-white/30"
            >
              <span className="text-[95%]">{product.installCommand}</span>
              {copied ? (
                <IconCheck className="ml-auto" />
              ) : (
                <IconCopyFill className="ml-auto" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{'Copy to clipboard'}</p>
          </TooltipContent>
        </Tooltip>
        <Button
          variant="secondary"
          asChild
          size="xl"
          className="h-11 rounded-lg text-sm md:h-12 md:text-base"
        >
          <Link href={product.docsPath}>
            <IconBook />
            Documentation
          </Link>
        </Button>
      </div>
      <p className="text-muted-foreground mt-2 text-center text-sm md:text-left">
        Currently v{packageJson.version}
      </p>
    </section>
  );
}

function DiffsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="64"
      height="32"
      viewBox="0 0 32 16"
      className="mb-2"
    >
      <path
        fill="currentcolor"
        d="M15.5 16H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3h12.5v16ZM8 4a1 1 0 0 0-1 1v2H5a1 1 0 0 0 0 2h2v2a1 1 0 1 0 2 0V9h2a1 1 0 1 0 0-2H9V5a1 1 0 0 0-1-1Z"
      />
      <path
        fill="currentcolor"
        d="M29 0a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H16.5V0H29Zm-9 8a1 1 0 0 0 1 1h6a1 1 0 1 0 0-2h-6a1 1 0 0 0-1 1Z"
        opacity=".4"
      />
    </svg>
  );
}

function TreesIcon() {
  return (
    <div className="mb-2 flex h-8 w-8 items-end">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="36"
        height="60"
        viewBox="0 0 18 30"
      >
        <path
          fill="currentcolor"
          d="M6.585 16c.14 0 .278.014.415.04v1.584l-.03-.018a.75.75 0 0 0-.385-.106H3.25a.75.75 0 0 0-.75.75V21h13v-1.25a.75.75 0 0 0-.75-.75H11v-1.5h3.75A2.25 2.25 0 0 1 17 19.75v1.291c.591.157 1.003.735.918 1.374l-.752 5.632A2.25 2.25 0 0 1 14.938 30H3.063a2.25 2.25 0 0 1-2.23-1.953l-.751-5.632A1.252 1.252 0 0 1 1 21.041V18.25A2.25 2.25 0 0 1 3.25 16h3.335Z"
        />
        <path
          fill="currentcolor"
          d="M8.47.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1-1.06 1.06L9.75 2.56v1.628l3.5 3.47a.75.75 0 0 1-1.061 1.06L9.75 6.303v2.074l4.03 4.03a.75.75 0 0 1-1.06 1.06l-2.97-2.969V21h-1.5V10.498l-2.97 2.97a.75.75 0 0 1-1.06-1.06l4.03-4.031V6.311L5.844 8.717a.75.75 0 0 1-1.06-1.06L8.25 4.188V2.561L6.28 4.53a.75.75 0 0 1-1.06-1.06L8.47.22Z"
          opacity=".4"
        />
      </svg>
    </div>
  );
}

function HeroIcon({ productId }: { productId: ProductId }) {
  return productId === 'diffs' ? <DiffsIcon /> : <TreesIcon />;
}
