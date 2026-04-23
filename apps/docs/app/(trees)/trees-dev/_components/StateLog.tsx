'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function useStateLog() {
  const [log, setLog] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev.slice(-49), msg]);
  }, []);

  return { log, addLog };
}

export function StateLog({
  entries,
  className,
}: {
  entries: string[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current != null) ref.current.scrollTop = ref.current.scrollHeight;
  }, [entries]);

  const boldIndices = useMemo(() => {
    const indices = new Set<number>();
    const seen = new Set<string>();
    for (let i = entries.length - 1; i >= 0; i--) {
      const prefix = entries[i].split(':')[0];
      if (!seen.has(prefix)) {
        seen.add(prefix);
        indices.add(i);
      }
    }
    return indices;
  }, [entries]);

  return (
    <div
      ref={ref}
      className={
        className ??
        'mt-2 h-24 overflow-y-auto rounded border p-2 font-mono text-xs'
      }
      style={{ borderColor: 'var(--color-border)' }}
    >
      {entries.length === 0 ? (
        <span className="text-muted-foreground italic">
          Interact with the tree to see state changes…
        </span>
      ) : (
        entries.map((entry, i) => (
          <div key={i} className={boldIndices.has(i) ? 'font-bold' : ''}>
            {entry}
          </div>
        ))
      )}
    </div>
  );
}
