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
    <section className="flex max-w-3xl flex-col gap-3 pt-20 pb-10 md:pb-20 lg:max-w-4xl">
      <HeroIcon productId={productId} />

      <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl lg:text-6xl">
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

      <div className="flex flex-col gap-3 min-[460px]:flex-row min-[460px]:items-center">
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
          className="h-11 rounded-lg px-5 text-sm md:h-12 md:text-base"
        >
          <Link href={product.docsPath}>
            <IconBook />
            Documentation
          </Link>
        </Button>
      </div>
      <p className="text-muted-foreground mt-2 text-sm">
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
        width="44"
        height="44"
        viewBox="0 0 16 16"
        className="flex-shrink-0"
      >
        <path
          d="M14.5 15H4.5C3.67157 15 3 14.3284 3 13.5V6.5C3 5.67157 3.67157 5 4.5 5H8.4C8.78516 5 9.15557 5.14816 9.43448 5.41379L10.0655 6.01478C10.3444 6.28041 10.7148 6.42857 11.1 6.42857H14.5C15.3284 6.42857 16 7.10014 16 7.92857V13.5C16 14.3284 15.3284 15 14.5 15Z"
          fill="currentcolor"
        />
        <path
          opacity="0.4"
          d="M13 5.42857H11.1C10.9716 5.42857 10.8481 5.37918 10.7552 5.29064L10.1241 4.68965C9.65928 4.24694 9.04194 4 8.4 4H4.5C3.11929 4 2 5.11929 2 6.5V11H1.5C0.671573 11 0 10.3284 0 9.5V2.5C0 1.67157 0.671573 1 1.5 1H5.4C5.78516 1 6.15557 1.14816 6.43448 1.41379L7.06552 2.01478C7.34443 2.28041 7.71484 2.42857 8.1 2.42857H11.5C12.3284 2.42857 13 3.10014 13 3.92857V5.42857Z"
          fill="currentcolor"
        />
      </svg>
    </div>
  );
}

function HeroIcon({ productId }: { productId: ProductId }) {
  return productId === 'diffs' ? <DiffsIcon /> : <TreesIcon />;
}
