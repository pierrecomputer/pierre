export function OptionsTable() {
  return (
    <div className="not-prose my-6 overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b">
            <th className="p-3 text-left font-medium">Property</th>
            <th className="p-3 text-left font-medium">Type</th>
            <th className="p-3 text-left font-medium">Default</th>
            <th className="p-3 text-left font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <td className="p-3">
              <code>theme</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">
                string | {'{'}dark, light{'}'}
              </code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">
                {'{'}dark: &apos;pierre-dark&apos;, light:
                &apos;pierre-light&apos;{'}'}
              </code>
            </td>
            <td className="p-3 text-sm">
              Any built-in Shiki theme or custom registered theme. Can pass an
              object with &apos;dark&apos; and &apos;light&apos; keys to theme
              based on OS or themeType setting. See{' '}
              <a
                href="https://shiki.style/themes"
                target="_blank"
                rel="noopener noreferrer"
              >
                Shiki themes
              </a>{' '}
              for available options.
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>themeType</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">
                &apos;system&apos; | &apos;dark&apos; | &apos;light&apos;
              </code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">&apos;system&apos;</code>
            </td>
            <td className="p-3 text-sm">
              When using dual themes, controls which theme to display. Force
              &apos;dark&apos; or &apos;light&apos; theme, or inherit from the
              OS (&apos;system&apos;) theme.
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>disableLineNumbers</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">boolean</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">false</code>
            </td>
            <td className="p-3 text-sm">
              Disable the line numbers for your diffs (generally not
              recommended).
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>overflow</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">
                &apos;scroll&apos; | &apos;wrap&apos;
              </code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">&apos;scroll&apos;</code>
            </td>
            <td className="p-3 text-sm">
              Whether code should &apos;wrap&apos; with long lines or
              &apos;scroll&apos;.
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>lang</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">string</code>
            </td>
            <td className="p-3 text-sm">
              <em className="text-muted-foreground">(auto-detected)</em>
            </td>
            <td className="p-3 text-sm">
              Override automatic language detection. Normally not needed if
              filename has valid extension. See{' '}
              <a
                href="https://shiki.style/languages"
                target="_blank"
                rel="noopener noreferrer"
              >
                Shiki languages
              </a>{' '}
              for options.
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>diffStyle</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">
                &apos;split&apos; | &apos;unified&apos;
              </code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">&apos;split&apos;</code>
            </td>
            <td className="p-3 text-sm">
              Controls whether the diff is presented side by side or in a
              unified (single column) view.
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>expandUnchanged</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">boolean</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">false</code>
            </td>
            <td className="p-3 text-sm">
              Force unchanged context regions to always render. By default they
              are collapsed. Depends on using the oldFile/newFile API or
              FileDiffMetadata including newLines.
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>diffIndicators</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">
                &apos;bars&apos; | &apos;classic&apos; | &apos;none&apos;
              </code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">&apos;bars&apos;</code>
            </td>
            <td className="p-3 text-sm">
              Line decorators to highlight changes. <strong>bars</strong>: Shows
              red/green bars on left edge. <strong>classic</strong>: Shows
              &apos;+&apos;/&apos;-&apos; characters. <strong>none</strong>: No
              indicators.
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>disableBackground</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">boolean</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">false</code>
            </td>
            <td className="p-3 text-sm">
              Disable the green/red background colors shown on added and deleted
              lines.
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>hunkSeparators</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">
                &apos;line-info&apos; | &apos;metadata&apos; |
                &apos;simple&apos;
              </code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">&apos;line-info&apos;</code>
            </td>
            <td className="p-3 text-sm">
              Customizes display between hunks. <strong>line-info</strong>:
              Shows collapsible bar with line count. <strong>metadata</strong>:
              Shows patch format like <code>@@ -60,6 +60,22 @@</code>.{' '}
              <strong>simple</strong>: Subtle bar separator.
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>lineDiffType</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">
                &apos;none&apos; | &apos;char&apos; | &apos;word&apos; |
                &apos;word-alt&apos;
              </code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">&apos;word-alt&apos;</code>
            </td>
            <td className="p-3 text-sm">
              Secondary highlights for changed parts within lines.{' '}
              <strong>none</strong>: No highlights. <strong>char</strong>:
              Character-level granularity. <strong>word</strong>: Word
              boundaries. <strong>word-alt</strong>: Word boundaries with
              minimized gaps.
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>maxLineDiffLength</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">number</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">1000</code>
            </td>
            <td className="p-3 text-sm">
              Skip lineDiffType highlighting if lines exceed this character
              length.
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>maxLineLengthForHighlighting</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">number</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">1000</code>
            </td>
            <td className="p-3 text-sm">
              Skip syntax highlighting entirely if any line exceeds this
              character length.
            </td>
          </tr>
          <tr className="border-b">
            <td className="p-3">
              <code>disableFileHeader</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">boolean</code>
            </td>
            <td className="p-3 text-sm">
              <code className="text-xs">false</code>
            </td>
            <td className="p-3 text-sm">
              Hide the file header with filename and diff stats.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
