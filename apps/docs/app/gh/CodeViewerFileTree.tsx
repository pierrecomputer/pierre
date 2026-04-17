import { cn } from '@/lib/utils';

interface CodeViewerFileTreeProps {
  className?: string;
}

export function CodeViewerFileTree({ className }: CodeViewerFileTreeProps) {
  return <div data-file-tree className={cn('min-h-0', className /**/)} />;
}
