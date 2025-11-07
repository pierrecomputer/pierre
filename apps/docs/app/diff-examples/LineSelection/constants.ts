import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

export const LINE_SELECTION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'example.tsx',
    contents: `import React from 'react';

interface ButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export function Button({
  onClick,
  children,
  variant = 'primary',
  disabled = false
}: ButtonProps) {
  const baseStyles = 'px-4 py-2 rounded-md font-medium transition-colors';

  const variantStyles = {
    primary: 'bg-blue-500 text-white hover:bg-blue-600',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300'
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={\`\${baseStyles} \${variantStyles[variant]}\`}
    >
      {children}
    </button>
  );
}`,
  },
  options: {
    theme: 'pierre-dark',
  },
};
