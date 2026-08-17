'use client';

import { IconArrowUpRight, IconChevronsNarrow } from '@pierre/icons';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { COPY_FEEDBACK_MS, CopyStateIcon } from '@/components/CopyStateIcon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  getAgentPrompt,
  getProductConfig,
  type ProductId,
} from '@/lib/product-config';

export interface AgentSkillMenuProps {
  productId: ProductId;
}

type CopyTarget = 'skillInstall' | 'agentPrompt';

// Matches the breakpoint where the hero switches its buttons from stacked to
// inline. Below it the trigger is full width, so a start-aligned menu hangs off
// to one side rather than sitting under the button.
const INLINE_BUTTONS_QUERY = '(min-width: 460px)';

function subscribeToInlineButtons(onChange: () => void) {
  const query = window.matchMedia(INLINE_BUTTONS_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function useInlineButtons() {
  return useSyncExternalStore(
    subscribeToInlineButtons,
    () => window.matchMedia(INLINE_BUTTONS_QUERY).matches,
    () => true
  );
}

export function AgentSkillMenu({ productId }: AgentSkillMenuProps) {
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const product = getProductConfig(productId);
  const inlineButtons = useInlineButtons();

  const copy = (target: CopyTarget, content: string) => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(content);
        clearTimeout(resetTimeoutRef.current);
        setCopiedTarget(target);
        resetTimeoutRef.current = setTimeout(
          () => setCopiedTarget(null),
          COPY_FEEDBACK_MS
        );
      } catch (err) {
        console.error('Failed to copy to clipboard', err);
      }
    })();
  };

  useEffect(
    () => () => {
      clearTimeout(resetTimeoutRef.current);
    },
    []
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xl" className="group">
          For Agents
          <IconChevronsNarrow className="-mr-0.5 opacity-75 group-hover:opacity-100 group-data-[state=open]:opacity-100" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={inlineButtons ? 'start' : 'center'}
        className="w-[min(16rem,calc(100vw-2rem))]"
      >
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            copy('skillInstall', product.skillInstallCommand);
          }}
          className="group cursor-pointer py-2"
        >
          Install the {product.name} skill
          <CopyStateIcon
            copied={copiedTarget === 'skillInstall'}
            className="ml-auto"
          />
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            copy('agentPrompt', getAgentPrompt(productId));
          }}
          className="group cursor-pointer py-2"
        >
          Copy the agent prompt
          <CopyStateIcon
            copied={copiedTarget === 'agentPrompt'}
            className="ml-auto"
          />
        </DropdownMenuItem>

        <DropdownMenuSeparator className="mx-1.5" />

        <DropdownMenuItem asChild className="cursor-pointer py-2">
          <a href={product.skillUrl} target="_blank" rel="noopener noreferrer">
            Learn more on skills.sh
            <IconArrowUpRight className="ml-auto opacity-60" />
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
