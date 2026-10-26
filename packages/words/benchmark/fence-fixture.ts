/** Grow one fence with alternating whole and partial lines, retaining a large settled prefix. */
export function createFenceFixture(lineCount: number, deliveries = 250) {
  const lines: string[] = [];
  for (let line = 0; line < lineCount; line++) {
    switch (line % 8) {
      case 0:
        lines.push(`// Record ${line}: a distinct highlighted line`);
        break;
      case 1:
        lines.push(
          `const record${line}: { id: number; name: string } = { id: ${line}, name: "item & <${line}>" };`
        );
        break;
      case 2:
        lines.push(
          `const label${line} = record${line - 1}.name.toUpperCase();`
        );
        break;
      case 3:
        lines.push(`if (label${line - 1}.length > ${line}) {`);
        break;
      case 4:
        lines.push(
          `  console.log("Rendering record", ${line}, Math.max(1, ${line}));`
        );
        break;
      case 5:
        lines.push('}');
        break;
      case 6:
        lines.push(`/* A multiline comment begins at ${line}`);
        break;
      default:
        lines.push(`   and ends at ${line}. */`);
    }
  }
  const code = lines.join('\n') + '\n';
  const source = '```typescript\n' + code + '```\n';
  const step = Math.max(1, Math.ceil(lineCount / deliveries));
  const ends: number[] = [];
  let offset = '```typescript\n'.length;
  for (let line = 0; line < lines.length; line++) {
    offset += lines[line].length + 1;
    if ((line + 1) % step === 0 && line + 1 < lines.length)
      ends.push(
        offset - (ends.length % 2 === 0 ? Math.min(13, lines[line].length) : 0)
      );
  }
  ends.push(source.length - 4);
  ends.push(source.length);
  return { source, code, ends, lineCount, linesPerDelivery: step };
}

/** Compare output without retaining a second large array of text chunks. */
export function fenceHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  return hash.toString(16);
}

export function fencePercentile(
  values: number[],
  fraction: number
): number | null {
  const ordered = values.slice().sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length * fraction)] ?? null;
}
