import { useId, useMemo } from 'react';
import type { PropsWithChildren } from 'react';

export interface OverflowTextProps extends PropsWithChildren {
  baseCss?: string;
  onOverflow?: string;
}

export function OverflowText({
  children,
  baseCss,
  onOverflow,
  ...props
}: OverflowTextProps) {
  const id = useId();

  const styleBlock = useMemo(() => {
    const baseStyles = baseCss ? `#${id} { ${baseCss} }` : '';
    const onOverflowStyles = onOverflow
      ? `@media (max-width: 768px) { #${id} { ${onOverflow} } }`
      : '';
    return `${baseStyles}${onOverflowStyles}`;
  }, [baseCss, id, onOverflow]);

  return (
    <div id={id} {...props}>
      <style>{styleBlock}</style>
      {children}
    </div>
  );
}
