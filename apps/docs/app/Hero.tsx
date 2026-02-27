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
    <div className="mb-2 flex h-8 w-14 items-end">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="54"
        height="44"
        viewBox="0 0 27 22"
      >
        <path
          fill="currentcolor"
          fill-rule="evenodd"
          d="M9.393 0a3.16 3.16 0 0 1 1.672.481l2.582 1.609c.168.105.36.16.557.16h7.863c1.795 0 3.25 1.511 3.25 3.375v.938c.855.234 1.45 1.102 1.327 2.06l-1.085 10.448C25.343 20.748 23.966 22 22.337 22h-8.588v-4.44l1.97 1.97a.75.75 0 0 0 1.061-1.06l-3.031-3.031v-.88l1.47 1.471a.75.75 0 0 0 1.061-1.06l-2.531-2.532v-.878l.72.72a.75.75 0 0 0 1.061-1.06l-2-2a.75.75 0 0 0-1.004-.052l-.056.052-2 2a.75.75 0 1 0 1.06 1.06l.719-.718v.878l-2.53 2.53a.75.75 0 1 0 1.061 1.06l1.469-1.469v.88l-3.03 3.029a.75.75 0 1 0 1.061 1.06l1.969-1.969V22H4.307c-1.63 0-3.007-1.252-3.222-2.929L0 8.623c-.003-.958.531-1.826 1.326-2.06V3.375C1.326 1.511 2.781 0 4.576 0zM4.576 2.25c-.598 0-1.083.504-1.083 1.125V6.5H23.15v-.875c0-.621-.484-1.125-1.083-1.125h-7.863a3.16 3.16 0 0 1-1.672-.481L9.95 2.41a1.05 1.05 0 0 0-.557-.16z"
          clip-rule="evenodd"
        />
      </svg>
    </div>
  );
}

function HeroIcon({ productId }: { productId: ProductId }) {
  return productId === 'diffs' ? <DiffsIcon /> : <TreesIcon />;
}
