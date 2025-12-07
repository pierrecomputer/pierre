import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadMultiFileDiffOptions } from '@pierre/precision-diffs/ssr';

export const LINE_SELECTION_EXAMPLE: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: {
    name: 'Button.tsx',
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
  const baseStyles = 'px-4 py-2 rounded-md font-medium';

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
  newFile: {
    name: 'Button.tsx',
    contents: `import React from 'react';

interface ButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
}

export function Button({
  onClick,
  children,
  variant = 'primary',
  disabled = false,
  size = 'medium'
}: ButtonProps) {
  const baseStyles = 'rounded-md font-medium transition-colors';

  const sizeStyles = {
    small: 'px-3 py-1 text-sm',
    medium: 'px-4 py-2',
    large: 'px-6 py-3 text-lg'
  };

  const variantStyles = {
    primary: 'bg-blue-500 text-white hover:bg-blue-600',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',
    danger: 'bg-red-500 text-white hover:bg-red-600'
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={\`\${baseStyles} \${sizeStyles[size]} \${variantStyles[variant]}\`}
    >
      {children}
    </button>
  );
}`,
  },
  options: {
    theme: 'pierre-dark',
    diffStyle: 'split',
    unsafeCSS: CustomScrollbarCSS,
  },
};
