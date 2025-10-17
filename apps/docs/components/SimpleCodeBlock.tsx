import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
} from '@/components/ui/shadcn-io/code-block';

import pierreDarkTheme from '../themes/pierre-dark.json';
import pierreLightTheme from '../themes/pierre-light.json';

interface SimpleCodeBlockProps {
  code: string;
  language?: string;
  className?: string;
  lineNumbers?: boolean;
}

export function SimpleCodeBlock({
  code,
  language = 'typescript',
  className,
  lineNumbers = true,
}: SimpleCodeBlockProps) {
  return (
    <CodeBlock
      data={[
        {
          language,
          filename: `code.${language}`,
          code,
        },
      ]}
      defaultValue={language}
      className={`not-prose ${className ?? ''}`}
    >
      <CodeBlockHeader>
        <CodeBlockFiles>
          {(item) => (
            <CodeBlockFilename key={item.language} value={item.language}>
              {item.filename}
            </CodeBlockFilename>
          )}
        </CodeBlockFiles>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem
            key={item.language}
            value={item.language}
            lineNumbers={lineNumbers}
          >
            <CodeBlockContent
              language={item.language}
              themes={{
                light: pierreLightTheme,
                dark: pierreDarkTheme,
              }}
            >
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  );
}
