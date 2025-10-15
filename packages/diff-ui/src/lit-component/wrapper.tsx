import { createElement } from '@lit-labs/ssr-react';

import './file-diff';

export const FileDiff = ({
  code,
  children,
  ...props
}: {
  code?: string;
  children: React.ReactNode;
}) => {
  return createElement(
    'file-diff',
    {
      code,
      ...props,
    },
    children
  );
};
