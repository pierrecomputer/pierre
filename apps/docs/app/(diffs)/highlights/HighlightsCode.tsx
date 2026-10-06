import { codeToHtml } from '@pierre/highlights';
import pierreDark from '@pierre/highlights/themes/pierre-dark';
import pierreLight from '@pierre/highlights/themes/pierre-light';
import { IconFileCode } from '@pierre/icons';

import styles from './HighlightsCode.module.css';

// Render static examples on the server, decoding each result before another
// call can reuse the highlighter's output buffer.
export function HighlightsCode({
  code,
  filename,
}: {
  code: string;
  filename?: string;
}) {
  const html = new TextDecoder().decode(
    codeToHtml(code, {
      lang: 'ts',
      themes: { light: pierreLight, dark: pierreDark },
      defaultColor: 'light-dark()',
    })
  );

  return (
    <div className="overflow-hidden rounded-lg border">
      {filename && (
        <div className="flex items-center gap-2 px-4 py-3 text-[13px]">
          <IconFileCode
            aria-hidden="true"
            className="text-muted-foreground size-4"
          />
          <span>{filename}</span>
        </div>
      )}
      <div className={styles.code} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
