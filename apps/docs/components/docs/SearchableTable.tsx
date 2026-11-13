'use client';

import { type ReactNode, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';

interface SearchableTableProps {
  /** A Markdown table. */
  children: ReactNode;
  label?: string;
}

// Wraps a long Markdown table with a filter box and a scroll area. The rows
// stay in the MDX source, so the plain-text docs keep the complete table.
export function SearchableTable({
  children,
  label = 'Search',
}: SearchableTableProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        placeholder={label}
        aria-label={label}
        className="max-w-xs"
        onChange={(event) => {
          const query = event.target.value.trim().toLowerCase();
          let count = 0;
          // WARNING: The server renders the rows, so React keeps no state for
          // them. Hide them in the DOM.
          for (const row of ref.current!.querySelectorAll<HTMLElement>(
            'tbody tr'
          )) {
            row.hidden = !row.textContent.toLowerCase().includes(query);
            if (!row.hidden) count++;
          }
          ref.current!.scrollTop = 0;
          setEmpty(count === 0);
        }}
      />
      <div
        ref={ref}
        className="[&_thead_th]:bg-background max-h-[28rem] overflow-y-auto [scrollbar-width:thin] [&_table]:w-full [&_table]:table-fixed [&_table]:border-separate [&_table]:border-spacing-0 [&_th:first-child]:w-48 [&_thead_th]:sticky [&_thead_th]:top-0"
      >
        {children}
        {empty && <p className="text-muted-foreground py-3">No matches</p>}
      </div>
    </div>
  );
}
